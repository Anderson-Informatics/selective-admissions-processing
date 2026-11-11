import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ aggregate: vi.fn(), findOne: vi.fn(), collation: vi.fn() }))
vi.mock('~~/server/models/GpaRecord', () => ({ GpaRecordModel: { aggregate: mocks.aggregate } }))
vi.mock('~~/server/models/Metadata', () => ({ MetadataModel: { findOne: mocks.findOne } }))
vi.mock('~~/server/models/Submission', () => ({ SubmissionModel: { collection: { name: 'submissions' } } }))

let handler: (event: unknown) => Promise<unknown>
let query: Record<string, string>

beforeAll(async () => {
  vi.stubGlobal('defineEventHandler', (fn: typeof handler) => fn)
  handler = (await import('./index.get')).default as typeof handler
})

beforeEach(() => {
  vi.clearAllMocks()
  query = { cycleId: 'cycle-1' }
  vi.stubGlobal('connectDb', vi.fn())
  vi.stubGlobal('requireAuth', vi.fn())
  vi.stubGlobal('getQuery', () => query)
  vi.stubGlobal('createError', (error: unknown) => error)
  mocks.findOne.mockReturnValue({ select: () => ({ lean: async () => ({ externalId: 'opt-in' }) }) })
  mocks.aggregate.mockReturnValue({ collation: mocks.collation })
  mocks.collation.mockResolvedValue([{ records: [{ _id: 'gpa-1' }], count: [{ total: 75 }] }])
})

function pipeline() {
  return mocks.aggregate.mock.calls[0]![0] as { $lookup?: unknown, $facet?: { records: Record<string, unknown>[], count: Record<string, unknown>[] } }[]
}

describe('GPA record browsing', () => {
  it('filters the source and searches both names plus exact integer identifiers before pagination', async () => {
    query = { ...query, source: 'dpscd', search: '12345', page: '2', limit: '50', sortBy: 'dpscd.studentNumber', sortOrder: 'asc' }
    expect(await handler({})).toEqual({ records: [{ _id: 'gpa-1' }], total: 75, page: 2, limit: 50 })
    const stages = pipeline()
    expect(stages[0]).toEqual({ $match: { cycleId: 'cycle-1', dpscd: { $exists: true } } })
    expect(stages.find(stage => stage.$lookup)?.$lookup).toMatchObject({
      from: 'submissions', let: { submissionId: '$submissionId', cycleId: '$cycleId' }
    })
    expect(stages[4]).toEqual({ $match: { $or: [
      { submissionName: { $regex: '12345', $options: 'i' } },
      { 'optIn.studentName': { $regex: '12345', $options: 'i' } },
      { submissionIdInt: 12345 }, { 'dpscd.studentNumber': 12345 }
    ] } })
    expect(stages[5]?.$facet?.records).toContainEqual({ $sort: { 'dpscd.studentNumber': 1, '_id': 1 } })
    expect(stages[5]?.$facet?.records).toContainEqual({ $skip: 50 })
    expect(stages[5]?.$facet?.count).toEqual([{ $count: 'total' }])
  })

  it('escapes name searches and rejects arbitrary sort fields', async () => {
    query = { ...query, search: 'Ann.*', sortBy: '$untrusted', sortOrder: 'asc' }
    await handler({})
    expect(pipeline()[4]).toEqual({ $match: { $or: [
      { submissionName: { $regex: 'Ann\\.\\*', $options: 'i' } },
      { 'optIn.studentName': { $regex: 'Ann\\.\\*', $options: 'i' } }
    ] } })
    expect(pipeline()[5]?.$facet?.records[0]).toEqual({ $sort: { updatedAt: 1, _id: 1 } })
  })

  it('handles empty results and bounds pagination', async () => {
    query = { ...query, page: '-1', limit: '99999', source: 'opt_in' }
    mocks.collation.mockResolvedValue([{ records: [], count: [] }])
    expect(await handler({})).toEqual({ records: [], total: 0, page: 1, limit: 500 })
    expect(pipeline()[0]).toEqual({ $match: { cycleId: 'cycle-1', optIn: { $exists: true } } })
  })

  it('requires a cycle', async () => {
    query = {}
    await expect(handler({})).rejects.toMatchObject({ statusCode: 400 })
    expect(mocks.aggregate).not.toHaveBeenCalled()
  })
})
