import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'

const mocks = vi.hoisted(() => ({ find: vi.fn(), distinct: vi.fn(), audit: vi.fn(), application: vi.fn(), submissions: vi.fn(), compile: vi.fn(), percentiles: vi.fn() }))
vi.mock('../../models/ScoreRecord', () => ({ ScoreRecordModel: { find: mocks.find } }))
vi.mock('../../models/Submission', () => ({ SubmissionModel: { distinct: mocks.distinct, find: mocks.submissions } }))
vi.mock('../../models/Application', () => ({ ApplicationModel: { findById: mocks.application } }))
vi.mock('../../utils/disclosureAudit', () => ({ recordDisclosure: mocks.audit }))
vi.mock('../../utils/scoreCompilation', () => ({ compileApplicationScores: mocks.compile, computePercentiles: mocks.percentiles, normalizeScoringConfig: (value: unknown) => value }))

type Handler = (event: unknown) => Promise<unknown>
let download: Handler, preview: Handler, list: Handler
const decision = { proposed: { schoolId: 'c', schoolName: 'School C', rank: 3 }, waitlists: [{ schoolId: 'a', schoolName: 'School A', rank: 1, aboveProposal: true }, { schoolId: 'b', schoolName: 'School B', rank: 2, aboveProposal: true }], diagnostics: [], schools: [{ schoolId: 'c', schoolName: 'School C', rank: 3, outcome: 'accept', primaryUserId: 'primary', controllingEntryIds: ['entry'], evidence: [{ entryId: 'entry', stageId: 'decision', reviewerId: 'primary', value: 'Accept', outcome: 'accept', authoritative: true }] }] }
const record = { submissionId: 'sub', applicationId: 'app', placementPathway: 'decision', totalAppScore: null, totalMarygroveScore: null, decision, compiledAt: '2026-01-01' }
beforeAll(async () => {
  vi.stubGlobal('defineEventHandler', (handler: Handler) => handler)
  download = (await import('./export.get')).default as Handler
  preview = (await import('./preview.post')).default as Handler
  list = (await import('./index.get')).default as Handler
})
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('connectDb', vi.fn())
  vi.stubGlobal('requireAuth', vi.fn(async () => ({ email: 'admin@example.test' })))
  vi.stubGlobal('getQuery', vi.fn(() => ({ cycleId: 'cycle', applicationId: 'app' })))
  vi.stubGlobal('readBody', vi.fn(async () => ({ cycleId: 'cycle', applicationId: 'app' })))
  vi.stubGlobal('setResponseHeader', vi.fn())
  vi.stubGlobal('createError', (value: object) => Object.assign(new Error(), value))
  mocks.distinct.mockResolvedValue(['withdrawn'])
  mocks.find.mockReturnValue({ sort: () => ({ limit: () => ({ lean: async () => [record] }) }) })
  mocks.audit.mockResolvedValue(undefined)
})
afterEach(() => vi.unstubAllGlobals())
describe('decision score routes', () => {
  it('exports a clearly proposed third choice, all waitlists and review provenance', async () => {
    const result = await download({})
    const workbook = XLSX.read(result, { type: 'buffer' })
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets.Scores!)
    expect(rows[0]).toMatchObject({ proposedSchool: 'School C', proposedChoice: 3, waitlists: '1: School A; 2: School B', proposalStatus: 'Proposed only — not final placement' })
    expect(workbook.SheetNames).toEqual(['Scores', 'School decisions', 'Decision evidence'])
    expect(XLSX.utils.sheet_to_json(workbook.Sheets['Decision evidence']!)[0]).toMatchObject({ reviewerId: 'primary', entryId: 'entry', controlling: true })
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'pii_export' }))
    expect(mocks.audit.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(setResponseHeader).mock.invocationCallOrder[0]!)
  })
  it('rejects the download when disclosure audit fails', async () => {
    mocks.audit.mockRejectedValue(new Error('audit failed'))
    await expect(download({})).rejects.toThrow('audit failed')
    expect(setResponseHeader).not.toHaveBeenCalled()
  })
  it('exposes pathway-aware persisted results and excludes withdrawn records', async () => {
    expect(await list({})).toEqual([record])
    expect(mocks.find).toHaveBeenCalledWith(expect.objectContaining({ submissionId: { $nin: ['withdrawn'] } }))
  })
  it('passes the application config to the read-only compiler and returns its decisions', async () => {
    const application = { _id: 'app', cycleId: 'cycle', name: 'App', placementPathway: 'decision', scoring: { components: ['gpa'] } }
    mocks.application.mockReturnValue({ lean: async () => application })
    mocks.compile.mockResolvedValue({ records: [{ submissionId: 'sub', record }], summary: { compiled: 1 } })
    mocks.percentiles.mockReturnValue(new Map())
    mocks.submissions.mockReturnValue({ select: () => ({ lean: async () => [{ submissionId: 'sub', mappedFields: { FullName: 'Student' } }] }) })
    const result = await preview({})
    expect(mocks.compile).toHaveBeenCalledWith({ cycleId: 'cycle', applicationId: 'app', config: application.scoring, application })
    expect(result).toMatchObject({ placementPathway: 'decision', supportingComponents: ['gpa'], records: [{ decision, totalAppScore: null }] })
  })
})
