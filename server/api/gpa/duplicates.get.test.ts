import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ aggregate: vi.fn(), findApplications: vi.fn() }))
vi.mock('~~/server/models/Application', () => ({ ApplicationModel: { find: mocks.findApplications } }))
vi.mock('~~/server/models/Submission', () => ({ SubmissionModel: { aggregate: mocks.aggregate } }))
vi.mock('~~/server/models/GpaRecord', () => ({ GpaRecordModel: { collection: { name: 'gparecords' } } }))
vi.mock('~~/server/utils/routingEvaluator', () => ({ canonicalGpaStatus: (value: unknown) => value === 'OOD Partial' ? 'Opt-In Partial' : String(value ?? '').trim() }))

let handler: (event: unknown) => Promise<unknown>
let query: Record<string, string>

beforeAll(async () => {
  vi.stubGlobal('defineEventHandler', (fn: typeof handler) => fn)
  handler = (await import('./duplicates.get')).default as typeof handler
})

beforeEach(() => {
  vi.clearAllMocks()
  query = { cycleId: 'cycle-1' }
  vi.stubGlobal('connectDb', vi.fn())
  vi.stubGlobal('requireAuth', vi.fn())
  vi.stubGlobal('getQuery', () => query)
  vi.stubGlobal('createError', (error: unknown) => error)
  mocks.aggregate.mockResolvedValue([])
  mocks.findApplications.mockReturnValue({ select: () => ({ lean: async () => [{ _id: 'app-1', name: 'Application A' }] }) })
})

describe('GET /api/gpa/duplicates', () => {
  it('preserves cycle-wide non-withdrawn scope, independent of table filters', async () => {
    query = { ...query, source: 'none', search: '999', gpaStatus: 'Complete', page: '2', limit: '1' }
    mocks.aggregate.mockResolvedValue([
      { studentNumber: '123', duplicateCount: 2, submissionId: 'sub-1', applicationId: 'app-1', gpaStatus: 'OOD Partial', status: 'Submitted' },
      { studentNumber: '123', duplicateCount: 2, submissionId: 'sub-2', applicationId: 'missing', status: 'Submitted' }
    ])
    expect(await handler({})).toEqual([
      { studentNumber: '123', duplicateCount: 2, submissionId: 'sub-1', applicationId: 'app-1', applicationName: 'Application A', gpaStatus: 'Opt-In Partial', status: 'Submitted' },
      { studentNumber: '123', duplicateCount: 2, submissionId: 'sub-2', applicationId: 'missing', applicationName: '', gpaStatus: 'Incomplete', status: 'Submitted' }
    ])
    const stages = mocks.aggregate.mock.calls[0]![0] as Array<Record<string, unknown>>
    expect(stages.filter(stage => stage.$match)).toEqual([
      { $match: { cycleId: 'cycle-1', status: { $not: /^withdrawn$/i } } },
      { $match: { duplicateStudentNumber: { $ne: '' } } },
      { $match: { duplicateCount: { $gt: 1 } } }
    ])
    const lookupIndex = stages.findIndex(stage => stage.$lookup)
    expect(lookupIndex).toBeGreaterThan(stages.findIndex(stage => stage.$unwind))
    expect(stages.find(stage => stage.$group)).toMatchObject({ $group: {
      _id: '$duplicateStudentNumber', duplicateCount: { $sum: 1 },
      submissions: { $push: { cycleId: '$cycleId', submissionId: '$submissionId', status: '$status' } }
    } })
    expect(stages.at(-1)).toEqual({ $sort: { studentNumber: 1, submissionIdInt: 1, submissionId: 1 } })
    expect(stages.some(stage => stage.$skip || stage.$limit)).toBe(false)
  })

  it('excludes withdrawn members before counting duplicate groups', async () => {
    await handler({})
    const stages = mocks.aggregate.mock.calls[0]![0]
    const excludedStatus = stages[0].$match.status.$not as RegExp
    const groups = [
      ['Submitted', 'Withdrawn'],
      ['Withdrawn', 'WITHDRAWN'],
      ['Submitted', 'Submitted', 'wItHdRaWn'],
      ['Submitted', 'In Progress']
    ].map(statuses => statuses.filter(status => !excludedStatus.test(status)))
    expect(groups.filter(group => group.length > 1)).toEqual([
      ['Submitted', 'Submitted'], ['Submitted', 'In Progress']
    ])
    expect(stages.findIndex((stage: Record<string, unknown>) => stage.$group)).toBeGreaterThan(0)
    expect(stages).toContainEqual({ $match: { duplicateCount: { $gt: 1 } } })
  })

  it('keeps student-number conversion and ignores blanks before grouping', async () => {
    await handler({})
    const stages = mocks.aggregate.mock.calls[0]![0]
    expect(stages[1]).toMatchObject({ $set: { duplicateStudentNumber: { $trim: { input: { $convert: {
      input: { $ifNull: ['$mappedFields.StudentNumber', ''] }, to: 'string', onError: '', onNull: ''
    } } } } } })
    expect(stages[2]).toEqual({ $match: { duplicateStudentNumber: { $ne: '' } } })
    expect(mocks.findApplications).not.toHaveBeenCalled()
  })

  it('requires a cycle and authentication before aggregation', async () => {
    query = {}
    await expect(handler({})).rejects.toMatchObject({ statusCode: 400 })
    vi.mocked(requireAuth).mockRejectedValueOnce(new Error('Unauthorized'))
    await expect(handler({})).rejects.toThrow('Unauthorized')
    expect(mocks.aggregate).not.toHaveBeenCalled()
  })
})
