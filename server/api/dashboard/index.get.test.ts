import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApplicationModel } from '../../models/Application'
import { JobModel } from '../../models/Job'
import { MetadataModel } from '../../models/Metadata'
import { ReviewModel } from '../../models/Review'
import { ReviewStageModel } from '../../models/ReviewStage'
import { SubmissionModel } from '../../models/Submission'
import { ValidationIssueModel } from '../../models/ValidationIssue'

vi.mock('../../models/Application', () => ({ ApplicationModel: { find: vi.fn() } }))
vi.mock('../../models/Job', () => ({ JobModel: { aggregate: vi.fn(), find: vi.fn() } }))
vi.mock('../../models/Metadata', () => ({ MetadataModel: { find: vi.fn() } }))
vi.mock('../../models/Review', () => ({ ReviewModel: { aggregate: vi.fn(), countDocuments: vi.fn() } }))
vi.mock('../../models/ReviewStage', () => ({ ReviewStageModel: { find: vi.fn() } }))
vi.mock('../../models/Submission', () => ({ SubmissionModel: { aggregate: vi.fn(), countDocuments: vi.fn() } }))
vi.mock('../../models/ValidationIssue', () => ({ ValidationIssueModel: { aggregate: vi.fn(), countDocuments: vi.fn() } }))

let handler: (event: unknown) => Promise<unknown>

beforeAll(async () => {
  vi.stubGlobal('defineEventHandler', (fn: typeof handler) => fn)
  handler = (await import('./index.get')).default as typeof handler
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('connectDb', vi.fn())
  vi.stubGlobal('requireAuth', vi.fn())
  vi.stubGlobal('getQuery', () => ({ cycleId: 'cycle-1' }))
  vi.mocked(ApplicationModel.find).mockReturnValue({
    select: () => ({
      sort: () => ({
        lean: async () => [{ _id: 'exam-1', name: 'Exam', type: 'exam', active: true }]
      })
    })
  } as never)
  vi.mocked(ReviewStageModel.find).mockReturnValue({ select: () => ({ lean: async () => [] }) } as never)
  vi.mocked(MetadataModel.find).mockReturnValue({ select: () => ({ lean: async () => [] }) } as never)
  vi.mocked(JobModel.find).mockReturnValue({
    select: () => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) })
  } as never)
  vi.mocked(SubmissionModel.countDocuments).mockResolvedValue(0)
  vi.mocked(ReviewModel.countDocuments).mockResolvedValue(0)
  vi.mocked(ValidationIssueModel.countDocuments).mockResolvedValue(0)
  vi.mocked(ReviewModel.aggregate).mockResolvedValue([])
  vi.mocked(JobModel.aggregate).mockResolvedValue([])
  vi.mocked(ValidationIssueModel.aggregate).mockResolvedValue([])
})

describe('GET /api/dashboard HSPT completion', () => {
  it.each([
    { linked: 0, percent: 0 },
    { linked: 1, percent: 25 }
  ])('reports $linked linked submissions as $percent%', async ({ linked, percent }) => {
    vi.mocked(SubmissionModel.aggregate).mockImplementation((pipeline) => {
      const group = (pipeline as { $group?: { hsptLinked?: unknown } }[])
        .find(stage => stage.$group?.hsptLinked)?.$group
      if (group) {
        expect(group.hsptLinked).toEqual({
          $sum: {
            $cond: [{ $ne: [{ $ifNull: ['$hsptResultId', ''] }, ''] }, 1, 0]
          }
        })
        return Promise.resolve([{
          _id: 'exam-1',
          total: 4,
          gpaRecordingTotal: 0,
          gpaRecordingComplete: 0,
          gpaDpscdTotal: 0,
          gpaDpscdComplete: 0,
          gpaOptInTotal: 0,
          gpaOptInComplete: 0,
          hsptLinked: linked
        }]) as never
      }
      return Promise.resolve([]) as never
    })

    const response = await handler({}) as {
      applications: { highlights: { key: string, completed: number, total: number, percent: number | null }[] }[]
    }
    expect(response.applications[0]?.highlights.find(item => item.key === 'hspt')).toMatchObject({
      completed: linked,
      total: 4,
      percent
    })
  })
})

describe('GET /api/dashboard GPA completion', () => {
  it('uses non-withdrawn submissions for totals and label-based GPA status groups, but keeps withdrawn stage entries', async () => {
    vi.mocked(MetadataModel.find).mockReturnValue({
      select: () => ({ lean: async () => [
        { externalId: 'dpscd', name: 'DPSCD' },
        { externalId: 'opt-in', name: 'Opt-In' }
      ] })
    } as never)
    vi.mocked(ReviewStageModel.find).mockReturnValue({
      select: () => ({ lean: async () => [{ applicationId: 'exam-1', stageId: 'recording', name: 'GPA Recording', role: 'work' }] })
    } as never)

    const activeFilter = { cycleId: 'cycle-1', status: { $not: /^withdrawn$/i } }
    const submissions = [
      { labelIds: [], gpaStatus: 'Complete', status: 'submitted' },
      { gpaStatus: 'Incomplete', status: 'submitted' },
      { labelIds: ['dpscd'], gpaStatus: 'Complete', status: 'submitted' },
      { labelIds: ['dpscd'], gpaStatus: 'DPSCD Partial', status: 'submitted' },
      { labelIds: ['opt-in'], gpaStatus: 'Complete', status: 'submitted' },
      { labelIds: ['opt-in'], gpaStatus: 'OOD Partial', status: 'submitted' },
      { labelIds: ['opt-in', 'dpscd'], gpaStatus: 'Complete', status: 'submitted' },
      { labelIds: ['dpscd'], gpaStatus: 'Complete', status: 'Withdrawn' }
    ]
    const active = submissions.filter(submission => !/^withdrawn$/i.test(submission.status))

    type Expression = string | number | boolean | null | Expression[] | { [key: string]: Expression }
    const evaluate = (expression: Expression, submission: (typeof submissions)[number]): unknown => {
      if (typeof expression === 'string' && expression.startsWith('$')) {
        return submission[expression.slice(1) as 'labelIds' | 'gpaStatus']
      }
      if (Array.isArray(expression)) return expression.map(value => evaluate(value, submission))
      if (expression && typeof expression === 'object') {
        if ('$literal' in expression) return expression.$literal
        if ('$ifNull' in expression) {
          const [value, fallback] = expression.$ifNull as Expression[]
          return evaluate(value!, submission) ?? evaluate(fallback!, submission)
        }
        if ('$in' in expression) {
          const [value, list] = expression.$in as Expression[]
          return (evaluate(list!, submission) as unknown[]).includes(evaluate(value!, submission))
        }
        if ('$eq' in expression) {
          const [left, right] = expression.$eq as Expression[]
          return evaluate(left!, submission) === evaluate(right!, submission)
        }
        if ('$not' in expression) return !evaluate((expression.$not as Expression[])[0]!, submission)
        if ('$and' in expression) return (expression.$and as Expression[]).every(value => evaluate(value, submission))
      }
      return expression
    }

    vi.mocked(SubmissionModel.aggregate).mockImplementation((pipeline) => {
      const stages = pipeline as { $match?: unknown, $group?: Record<string, unknown>, $unwind?: unknown }[]
      const match = stages[0]?.$match
      const group = stages.find(stage => stage.$group)?.$group
      if (stages.some(stage => stage.$unwind)) {
        expect(match).toEqual({ cycleId: 'cycle-1' })
        return Promise.resolve([{
          _id: { applicationId: 'exam-1', stageId: 'withdrawn' },
          name: 'Withdrawn Application',
          order: 9,
          role: 'work',
          required: 1,
          completed: 1
        }]) as never
      }
      expect(match).toEqual(activeFilter)
      if (group?.gpaRecordingTotal) {
        const result: Record<string, number | string> = { _id: 'exam-1', total: active.length, hsptLinked: 0 }
        for (const key of ['gpaRecordingTotal', 'gpaRecordingComplete', 'gpaDpscdTotal', 'gpaDpscdComplete', 'gpaOptInTotal', 'gpaOptInComplete']) {
          const sum = group[key] as { $sum: { $cond: [Expression, number, number] } }
          result[key] = active.filter(submission => evaluate(sum.$sum.$cond[0], submission)).length
        }
        return Promise.resolve([result]) as never
      }
      if ((group?._id as { gpaStatus?: unknown } | undefined)?.gpaStatus) return Promise.resolve([
        { _id: { applicationId: 'exam-1', gpaStatus: 'Complete' }, total: 4 }
      ]) as never
      if (group?.mapped) return Promise.resolve([
        { _id: 'exam-1', total: active.length, mapped: 0, completed: 0 }
      ]) as never
      return Promise.resolve([]) as never
    })
    vi.mocked(SubmissionModel.countDocuments).mockImplementation((filter) => {
      expect(filter).toMatchObject(activeFilter)
      return Promise.resolve(active.length) as never
    })

    const response = await handler({}) as {
      totals: { submissions: number }
      applications: {
        total: number
        highlights: { key: string, completed: number, total: number, segments: { key: string, completed: number, total: number }[] }[]
        stages: { stageId: string }[]
      }[]
    }
    expect(response.totals.submissions).toBe(7)
    expect(response.applications[0]?.total).toBe(7)
    expect(response.applications[0]?.stages).toEqual([expect.objectContaining({ stageId: 'withdrawn' })])
    const gpa = response.applications[0]?.highlights.find(highlight => highlight.key === 'gpa')
    expect(gpa).toMatchObject({ completed: 4, total: 7 })
    expect(gpa?.segments).toEqual([
      expect.objectContaining({ key: 'gpa-recording', completed: 1, total: 2 }),
      expect.objectContaining({ key: 'dpscd-gpa', completed: 2, total: 3 }),
      expect.objectContaining({ key: 'optin-gpa', completed: 2, total: 3 })
    ])
    expect(response.applications[0]?.highlights.find(highlight => highlight.key === 'hspt')?.total).toBe(7)
  })
})
