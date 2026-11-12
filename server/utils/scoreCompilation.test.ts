import { describe, expect, it, vi } from 'vitest'
import { ApplicationModel } from '../models/Application'
import { GpaRecordModel } from '../models/GpaRecord'
import { HSPTResultModel } from '../models/HSPTResult'
import { ReviewModel } from '../models/Review'
import { ReviewStageModel } from '../models/ReviewStage'
import { SubmissionModel } from '../models/Submission'
import { compileApplicationScores, computePercentiles, normalizeScoringConfig, runScoreCompilation } from './scoreCompilation'

vi.mock('../models/Application', () => ({ ApplicationModel: { find: vi.fn() } }))
vi.mock('../models/Submission', () => ({ SubmissionModel: { find: vi.fn() } }))
vi.mock('../models/HSPTResult', () => ({ HSPTResultModel: { find: vi.fn() } }))
vi.mock('../models/GpaRecord', () => ({ GpaRecordModel: { find: vi.fn(), bulkWrite: vi.fn(async () => ({})) } }))
vi.mock('../models/Review', () => ({ ReviewModel: { find: vi.fn() } }))
vi.mock('../models/ReviewStage', () => ({ ReviewStageModel: { find: vi.fn() } }))
vi.mock('../models/Metadata', () => ({ MetadataModel: { findOne: vi.fn(() => ({ select: () => ({ lean: async () => ({ externalId: 'gpa-bonus-label' }) }) })) } }))

const lean = (items: unknown[]) => ({ lean: async () => items })
const selectLean = (items: unknown[]) => ({ select: () => lean(items) })

function mockData({ submissions = [], hspt = [], gpa = [], reviews = [], essayStages = [] }: {
  submissions?: unknown[]
  hspt?: unknown[]
  gpa?: unknown[]
  reviews?: unknown[]
  essayStages?: unknown[]
}) {
  vi.mocked(SubmissionModel.find).mockReturnValue(lean(submissions) as never)
  vi.mocked(HSPTResultModel.find).mockReturnValue(lean(hspt) as never)
  vi.mocked(GpaRecordModel.find).mockReturnValue(lean(gpa) as never)
  vi.mocked(ReviewModel.find).mockReturnValue(lean(reviews) as never)
  vi.mocked(ReviewStageModel.find).mockReturnValue(selectLean(essayStages) as never)
}

const fullConfig = normalizeScoringConfig({ enabled: true, marygroveBonuses: { primary: 8, secondary: 4 } })
const minimalConfig = normalizeScoringConfig({ enabled: true, components: ['gpa', 'exam'], requireComplete: false })

describe('normalizeScoringConfig', () => {
  it('applies legacy defaults', () => {
    const config = normalizeScoringConfig(undefined)
    expect(config.components).toEqual(['gpa', 'exam', 'essay', 'dpscdBonus', 'marygroveBonus'])
    expect(config.gpaBonusPoints).toBe(5)
    expect(config.dpscdBonusPoints).toBe(10)
    expect(config.requireComplete).toBe(true)
  })
})

describe('compileApplicationScores', () => {
  it('compiles a fully-ready 9th-grade record with both totals', async () => {
    mockData({
      submissions: [{ submissionId: 'sub-1', labelIds: ['gpa-bonus-label'], catchment: { marygrove: 'Primary' }, mappedFields: { DPSCD: 'Yes' } }],
      hspt: [{ linkedSubmissionId: 'sub-1', status: 'linked', sourceId: 'src-1', reading: 10, math: 12, language: 9, science: 6, overall: 37 }],
      gpa: [{ submissionId: 'sub-1', resolvedCumulativeGpa: 3.95, resolvedSource: 'recording', dpscd: { quartersAvailable: 8 } }],
      essayStages: [{ stageId: 'essay-stage', name: 'Essay Scoring' }],
      reviews: [{ submissionId: 'sub-1', stageId: 'essay-stage', stageName: 'Essay Scoring', status: 'completed', score: 18, completedAt: new Date() }]
    })
    const output = await compileApplicationScores({ cycleId: 'c1', applicationId: 'a1', config: fullConfig, gpaBonusLabelId: 'gpa-bonus-label' })
    const record = output.records[0]!.record
    expect(record.hsptTaken && record.gpaRecorded && record.essayScored).toBe(true)
    expect(record.gpa?.score).toBe(35) // 30 * 1 + 5 bonus
    expect(record.dpscdBonus).toBe(10)
    expect(record.marygroveBonus).toBe(8)
    expect(record.totalAppScore).toBe(37 + 35 + 18 + 10)
    expect(record.totalMarygroveScore).toBe(37 + 35 + 18 + 10 + 8)
    expect(output.gpaOperations[0]).toMatchObject({ updateOne: { update: { $set: { gpaMultiplier: 1, gpaBonusEligible: true, gpaScore: 35 } } } })
  })

  it('gates totals to 0 when required inputs are missing', async () => {
    mockData({ submissions: [{ submissionId: 'sub-1', labelIds: [], catchment: { marygrove: 'None' } }], essayStages: [{ stageId: 'essay-stage', name: 'Essay' }] })
    const output = await compileApplicationScores({ cycleId: 'c1', applicationId: 'a1', config: fullConfig, gpaBonusLabelId: undefined })
    const record = output.records[0]!.record
    expect(record.totalAppScore).toBe(0)
    expect(record.totalMarygroveScore).toBe(0)
    expect(output.summary).toMatchObject({ missingExam: 1, missingGpa: 1, missingEssay: 1, ready: 0 })
  })

  it('compiles the minimal exam+gpa recipe without essay gating', async () => {
    mockData({
      submissions: [{ submissionId: 'sub-1', labelIds: [] }],
      hspt: [{ linkedSubmissionId: 'sub-1', status: 'linked', sourceId: 'src-1', reading: 1, math: 2, language: 3, science: 4, overall: 10 }],
      gpa: [{ submissionId: 'sub-1', resolvedCumulativeGpa: 3.0, resolvedSource: 'dpscd', dpscd: { quartersAvailable: 6 } }]
    })
    const output = await compileApplicationScores({ cycleId: 'c1', applicationId: 'a1', config: minimalConfig })
    const record = output.records[0]!.record
    expect(record.totalAppScore).toBe(10 + 20) // exam 10 + gpa pts 20 (>2.9 band) * 1
    expect(record.essayScored).toBe(false)
  })

  it('reselects snapshots during scoring and clears stale partial scores until a review is completed', async () => {
    vi.mocked(ApplicationModel.find).mockReturnValue(lean([{ _id: 'a1', rounds: [
      { key: 'first', order: 1, active: true, startDate: new Date('2026-01-01'), endDate: new Date('2026-02-01') },
      { key: 'second', order: 2, active: true, startDate: new Date('2026-02-02'), endDate: new Date('2026-03-01') }
    ] }]) as never)
    const snapshots = { r1: { cumulativeGpa: 3.5, quartersAvailable: 5 }, all: { cumulativeGpa: 3.95, quartersAvailable: 9 } }
    const data = {
      submissions: [{ submissionId: 'early', completedAt: new Date('2026-01-15') }, { submissionId: 'later', completedAt: new Date('2026-02-15') }],
      gpa: ['early', 'later'].map(submissionId => ({ submissionId, resolvedCumulativeGpa: 4, resolvedSource: 'dpscd', dpscd: { cumulativeGpa: 4, quartersAvailable: 9, snapshots } }))
    }
    mockData(data)
    const output = await compileApplicationScores({ cycleId: 'c1', applicationId: 'a1', config: minimalConfig })
    expect(output.records[0]!.record).toMatchObject({ gpaRecorded: false, gpa: { raw: null, source: null, score: null } })
    expect(output.records[1]!.record).toMatchObject({ gpaRecorded: true, gpa: { raw: 3.95, source: 'dpscd', multiplier: 1, score: 30 } })
    mockData({ ...data, reviews: [{ submissionId: 'early', stageId: 'partial', stageName: 'Partial GPA', status: 'completed', mappedData: { PartialGPA: 3.95, Semesters: 'One semester (or 2-3 quarters)' } }] })
    const reviewed = await compileApplicationScores({ cycleId: 'c1', applicationId: 'a1', config: minimalConfig })
    expect(reviewed.records[0]!.record).toMatchObject({ gpaRecorded: true, gpa: { raw: 3.95, source: 'partial', multiplier: 0.4, score: 12 } })
  })

  it('applies the Semesters multiplier for partial GPA', async () => {
    mockData({
      submissions: [{ submissionId: 'sub-1', labelIds: [] }],
      hspt: [{ linkedSubmissionId: 'sub-1', status: 'linked', sourceId: 's', reading: 0, math: 0, language: 0, science: 0, overall: 20 }],
      gpa: [{ submissionId: 'sub-1', resolvedCumulativeGpa: 3.95, resolvedSource: 'partial' }],
      essayStages: [{ stageId: 'essay-stage', name: 'Essay Scoring' }],
      reviews: [
        { submissionId: 'sub-1', stageId: 'essay-stage', stageName: 'Essay Scoring', status: 'completed', score: 10, completedAt: new Date() },
        { submissionId: 'sub-1', stageId: 'pgpa-stage', stageName: 'Partial GPA', status: 'completed', mappedData: { PartialGPA: 3.95, Semesters: 'One semester (or 2-3 quarters)' }, completedAt: new Date() }
      ]
    })
    const output = await compileApplicationScores({ cycleId: 'c1', applicationId: 'a1', config: fullConfig, gpaBonusLabelId: undefined })
    const record = output.records[0]!.record
    expect(record.gpa?.multiplier).toBe(0.4)
    expect(record.gpa?.score).toBe(12) // 30 * 0.4
    expect(record.totalAppScore).toBe(20 + 12 + 10)
  })

  it('skips withdrawn submissions and does not create GPA operations for them', async () => {
    mockData({
      submissions: [
        { submissionId: 'active', status: 'Submitted', labelIds: [] },
        { submissionId: 'withdrawn', status: 'Withdrawn', labelIds: [] }
      ],
      gpa: [{ submissionId: 'withdrawn', resolvedCumulativeGpa: 4, resolvedSource: 'dpscd' }]
    })

    const output = await compileApplicationScores({ cycleId: 'c1', applicationId: 'a1', config: minimalConfig })

    expect(output.records.map(record => record.submissionId)).toEqual(['active'])
    expect(output.withdrawnSubmissionIds).toEqual(['withdrawn'])
    expect(output.gpaOperations.map(operation => (operation as { updateOne: { filter: { submissionId: string } } }).updateOne.filter.submissionId)).toEqual(['active'])
    expect(output.summary).toMatchObject({ submissions: 1, skippedWithdrawn: 1 })
  })
})

describe('computePercentiles', () => {
  it('ranks non-null values within the population', async () => {
    const records = [10, 20, 30, null].map((total, i) => ({
      submissionId: `s${i}`,
      record: { totalAppScore: total ?? 0, totalMarygroveScore: 0, dpscdBonus: 0, marygroveBonus: 0, hsptTaken: false, gpaRecorded: false, essayScored: false, cycleId: 'c', applicationId: 'a', submissionId: `s${i}`, ...(total == null ? {} : { gpa: { score: total } }) }
    }))
    const percentiles = computePercentiles(records as never)
    expect(percentiles.get('s0')?.gpa).toBe(0)
    expect(percentiles.get('s1')?.gpa).toBeCloseTo(33.33)
    expect(percentiles.get('s2')?.gpa).toBeCloseTo(66.67)
    expect(percentiles.get('s3')?.gpa).toBeNull()
  })
})

describe('runScoreCompilation', () => {
  it('persists nothing in dryRun and reports per-application summaries', async () => {
    vi.mocked(ApplicationModel.find).mockReturnValue(lean([{ _id: 'a1', name: '9th Grade', scoring: { enabled: true, components: ['exam'] } }]) as never)
    mockData({ submissions: [{ submissionId: 'sub-1', labelIds: [] }], hspt: [{ linkedSubmissionId: 'sub-1', status: 'linked', overall: 25 }] })
    const { ScoreRecordModel } = await import('../models/ScoreRecord')
    const bulkSpy = vi.spyOn(ScoreRecordModel, 'bulkWrite').mockResolvedValue({} as never)
    const result = await runScoreCompilation({ cycleId: 'c1', dryRun: true })
    expect(result.result.applications[0]).toMatchObject({ name: '9th Grade', summary: { compiled: 1, missingExam: 0 } })
    expect(bulkSpy).not.toHaveBeenCalled()
  })

  it('clears stale score records for withdrawn submissions on non-dry-run compilations', async () => {
    vi.mocked(ApplicationModel.find).mockReturnValue(lean([{ _id: 'a1', name: '9th Grade', scoring: { enabled: true, components: ['exam'] } }]) as never)
    mockData({ submissions: [
      { submissionId: 'active', status: 'Submitted' },
      { submissionId: 'withdrawn', status: 'Withdrawn' }
    ] })
    const { ScoreRecordModel } = await import('../models/ScoreRecord')
    const deleteSpy = vi.spyOn(ScoreRecordModel, 'deleteMany').mockResolvedValue({ deletedCount: 1 } as never)
    vi.spyOn(ScoreRecordModel, 'bulkWrite').mockResolvedValue({} as never)

    const result = await runScoreCompilation({ cycleId: 'c1' })

    expect(deleteSpy).toHaveBeenCalledWith({ cycleId: 'c1', applicationId: 'a1', submissionId: { $in: ['withdrawn'] } })
    expect(result.result.applications[0]?.summary).toMatchObject({ skippedWithdrawn: 1, clearedWithdrawnScoreRecords: 1 })
  })

  it('reports stale withdrawn score records without deleting them in dry runs', async () => {
    vi.mocked(ApplicationModel.find).mockReturnValue(lean([{ _id: 'a1', name: '9th Grade', scoring: { enabled: true, components: ['exam'] } }]) as never)
    mockData({ submissions: [{ submissionId: 'withdrawn', status: 'Withdrawn' }] })
    const { ScoreRecordModel } = await import('../models/ScoreRecord')
    const countSpy = vi.spyOn(ScoreRecordModel, 'countDocuments').mockResolvedValue(2 as never)
    const deleteSpy = vi.spyOn(ScoreRecordModel, 'deleteMany')

    const result = await runScoreCompilation({ cycleId: 'c1', dryRun: true })

    expect(countSpy).toHaveBeenCalledWith({ cycleId: 'c1', applicationId: 'a1', submissionId: { $in: ['withdrawn'] } })
    expect(deleteSpy).not.toHaveBeenCalled()
    expect(result.result.applications[0]?.summary.wouldClearWithdrawnScoreRecords).toBe(2)
  })

  it('reports when no applications have scoring enabled', async () => {
    vi.mocked(ApplicationModel.find).mockReturnValue(lean([]) as never)
    const result = await runScoreCompilation({ cycleId: 'c1' })
    expect(result.result.applications).toEqual([])
  })
})
