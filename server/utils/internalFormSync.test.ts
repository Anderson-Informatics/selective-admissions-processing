import { beforeEach, describe, expect, it, vi } from 'vitest'
import { extractMappingValue, isDecisionAggregateMapping, syncInternalForms, type MappingContext } from './internalFormSync'
import { ScoreRecordModel } from '../models/ScoreRecord'
import { SubmissionModel } from '../models/Submission'
import { GpaRecordModel } from '../models/GpaRecord'
import { HSPTResultModel } from '../models/HSPTResult'
import { createInternalFormEntry, fetchEntry, fetchForm, fetchSubmissionEntries, updateInternalFormEntry } from './submittable'
import { normalizeScoringConfig } from './scoreCompilation'

vi.mock('../models/ScoreRecord', () => ({ ScoreRecordModel: { find: vi.fn(), updateOne: vi.fn() } }))
vi.mock('../models/Submission', () => ({ SubmissionModel: { find: vi.fn() } }))
vi.mock('../models/GpaRecord', () => ({ GpaRecordModel: { find: vi.fn() } }))
vi.mock('../models/HSPTResult', () => ({ HSPTResultModel: { find: vi.fn() } }))
vi.mock('../models/AuditLog', () => ({ AuditLogModel: { insertMany: vi.fn() } }))
vi.mock('./submittable', () => ({ fetchForm: vi.fn(), fetchSubmissionEntries: vi.fn(), fetchEntry: vi.fn(), createInternalFormEntry: vi.fn(), updateInternalFormEntry: vi.fn() }))
const lean = (items: unknown[]) => ({ lean: async () => items })
const config = normalizeScoringConfig({ components: ['exam'], internalForm: { formId: 'form', fields: { total: { source: 'scoring', field: 'totalAppScore', default: 999 }, exam: { source: 'scoring', field: 'exam.overall' }, ready: { source: 'condition', field: 'ready' } } } })
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(ScoreRecordModel.find).mockReturnValue({ sort: () => lean([{ submissionId: 'sub', placementPathway: 'decision', totalAppScore: null, hsptTaken: true, gpaRecorded: false, essayScored: false, exam: { overall: 50 } }]) } as never)
  vi.mocked(SubmissionModel.find).mockReturnValue(lean([{ submissionId: 'sub' }]) as never)
  vi.mocked(GpaRecordModel.find).mockReturnValue(lean([]) as never)
  vi.mocked(HSPTResultModel.find).mockReturnValue(lean([]) as never)
  vi.mocked(fetchForm).mockResolvedValue({ formId: 'form', name: 'Internal', fields: [{ formFieldId: 'total', label: 'Total', fieldType: 'number' }, { formFieldId: 'exam', label: 'Exam', fieldType: 'number' }, { formFieldId: 'ready', label: 'Ready', fieldType: 'single_checkbox' }] })
  vi.mocked(fetchSubmissionEntries).mockResolvedValue([])
})
describe('decision internal-form boundaries', () => {
  it('uses explicit input completeness instead of all three legacy flags', () => {
    const ctx = { now: new Date(), score: { inputsComplete: true, hsptTaken: true, gpaRecorded: false, essayScored: false } } as MappingContext
    expect(extractMappingValue({ source: 'condition', field: 'ready' }, ctx)).toBe(true)
    expect(isDecisionAggregateMapping({ source: 'scoring', field: 'percentiles.totalMarygrove', default: 42 })).toBe(true)
  })
  it('omits protected totals and their defaults when creating entries, retaining supporting fields', async () => {
    await syncInternalForms({ cycleId: 'cycle', applicationId: 'app', actor: 'test', config })
    expect(createInternalFormEntry).toHaveBeenCalledWith('sub', [expect.objectContaining({ formFieldId: 'exam', value: 50 }), expect.objectContaining({ formFieldId: 'ready', value: true })], undefined)
  })
  it('does not overwrite an existing total', async () => {
    vi.mocked(fetchSubmissionEntries).mockResolvedValue([{ formType: 'internal', entryId: 'entry' }] as never)
    vi.mocked(fetchEntry).mockResolvedValue({ fieldData: [{ formFieldId: 'total', fieldType: 'number', value: 123 }, { formFieldId: 'exam', fieldType: 'number', value: 0 }] } as never)
    await syncInternalForms({ cycleId: 'cycle', applicationId: 'app', actor: 'test', config })
    expect(updateInternalFormEntry).toHaveBeenCalledWith('entry', [expect.objectContaining({ formFieldId: 'total', value: 123 }), expect.objectContaining({ formFieldId: 'exam', value: 50 })], undefined)
  })
  it('performs no external or status writes in dry runs', async () => {
    await syncInternalForms({ cycleId: 'cycle', applicationId: 'app', actor: 'test', config, dryRun: true })
    expect(createInternalFormEntry).not.toHaveBeenCalled()
    expect(updateInternalFormEntry).not.toHaveBeenCalled()
    expect(ScoreRecordModel.updateOne).not.toHaveBeenCalled()
  })
})
