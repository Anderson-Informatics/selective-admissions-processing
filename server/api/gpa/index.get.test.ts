import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ aggregate: vi.fn(), collation: vi.fn(), findOne: vi.fn() }))
vi.mock('~~/server/models/Submission', () => ({ SubmissionModel: { aggregate: mocks.aggregate } }))
vi.mock('~~/server/models/GpaRecord', () => ({ GpaRecordModel: { collection: { name: 'gparecords' } } }))
vi.mock('~~/server/models/Review', () => ({ ReviewModel: { collection: { name: 'reviews' } } }))
vi.mock('~~/server/models/Metadata', () => ({ MetadataModel: { findOne: mocks.findOne } }))
vi.mock('~~/server/utils/routingEvaluator', () => ({ canonicalGpaStatus: (value: unknown) => value === 'OOD Partial' ? 'Opt-In Partial' : String(value ?? '').trim() }))

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
  mocks.collation.mockResolvedValue([{ records: [{ _id: 'sub-1' }], count: [{ total: 75 }] }])
})

interface PipelineStage {
  $lookup?: { as?: string }
  $match?: { $and?: unknown[] }
  $set?: Record<string, unknown>
  $facet?: { records: PipelineStage[], count: PipelineStage[] }
  [key: string]: unknown
}

function pipeline() {
  return mocks.aggregate.mock.calls.at(-1)![0] as PipelineStage[]
}

function records() {
  return pipeline().at(-1)!.$facet!.records
}

describe('GET /api/gpa', () => {
  it('joins only GPA before filtering and enriches reviews after pagination', async () => {
    query = { ...query, gpaStatus: 'OOD Partial', source: 'optIn', page: '2', limit: '50', sortBy: 'resolvedCumulativeGpa', sortOrder: 'desc' }
    expect(await handler({})).toEqual({ records: [{ _id: 'sub-1' }], total: 75, page: 2, limit: 50 })
    const stages = pipeline()
    expect(stages[0]).toEqual({ $match: { cycleId: 'cycle-1', status: { $not: /^withdrawn$/i } } })
    expect(stages.filter(stage => stage.$lookup).map(stage => stage.$lookup?.as)).toEqual(['_gpa'])
    expect(stages.find(stage => stage.$match?.$and)).toMatchObject({ $match: { $and: [
      {}, { gpaStatus: 'Opt-In Partial' }, { 'gpa.resolvedSource': 'optIn' }
    ] } })
    expect(records().slice(0, 3)).toEqual([
      { $sort: { resolvedCumulativeGpa: -1, _id: 1 } }, { $skip: 50 }, { $limit: 50 }
    ])
    expect(records().filter(stage => stage.$lookup).map(stage => stage.$lookup?.as)).toEqual(['_recordingReviews', '_partialReviews'])
    expect(stages.at(-1)?.$facet?.count).toEqual([{ $count: 'total' }])
    expect(mocks.aggregate).toHaveBeenCalledTimes(1)
    expect(mocks.collation).toHaveBeenCalledWith({ locale: 'en', strength: 2 })
  })

  it('looks up partial reviews before sorting by enrollment, but only in the records branch', async () => {
    query.sortBy = 'enrollmentConsidered'
    await handler({})
    expect(pipeline().filter(stage => stage.$lookup).map(stage => stage.$lookup?.as)).toEqual(['_gpa'])
    const branch = records()
    const sortIndex = branch.findIndex(stage => stage.$sort)
    const limitIndex = branch.findIndex(stage => stage.$limit)
    expect(branch.findIndex(stage => stage.$lookup?.as === '_partialReviews')).toBeLessThan(sortIndex)
    expect(branch.findIndex(stage => stage.$set?.enrollmentConsidered)).toBeLessThan(sortIndex)
    expect(branch.findIndex(stage => stage.$lookup?.as === '_recordingReviews')).toBeGreaterThan(limitIndex)
    expect(branch.filter(stage => stage.$lookup?.as === '_partialReviews')).toHaveLength(1)
    expect(pipeline().at(-1)?.$facet?.count).toEqual([{ $count: 'total' }])
  })

  it.each([
    'submissionIdInt', 'student', 'gpaStatus', 'resolvedCumulativeGpa',
    'resolvedSource', 'currentStageName', 'status', 'updatedAtTimestamp', 'gpa.updatedAt'
  ])('preserves %s sorting before page enrichment', async (sortBy) => {
    query = { ...query, sortBy, sortOrder: 'desc', page: '3', limit: '50' }
    await handler({})
    expect(records().slice(0, 3)).toEqual([
      { $sort: { [sortBy]: -1, _id: 1 } }, { $skip: 100 }, { $limit: 50 }
    ])
    const lookups = records().filter(stage => stage.$lookup)
    expect(lookups).toHaveLength(2)
    for (const stage of lookups) {
      expect(stage).toMatchObject({ $lookup: { pipeline: [
        { $match: { $expr: { $and: [
          { $eq: ['$submissionId', '$$submissionId'] }, { $eq: ['$cycleId', '$$cycleId'] }
        ] } } },
        { $match: { $and: [
          { $or: [{ status: { $regex: /^complete(d)?$/i } }, { completedAt: { $exists: true, $ne: null } }] },
          expect.any(Object)
        ] } },
        { $project: { stageName: 1, status: 1, mappedData: 1, completedAt: 1, createdAt: 1 } },
        { $sort: { completedAt: -1, createdAt: -1 } },
        { $limit: 1 }
      ] } })
    }
  })

  it('searches names and exact integer identifiers, escaping regex input', async () => {
    query.search = '12345'
    await handler({})
    expect(pipeline().find(stage => stage.$match?.$and)).toMatchObject({ $match: { $and: [{ $or: [
      { student: { $regex: '12345', $options: 'i' } },
      { 'gpa.dpscd.studentName': { $regex: '12345', $options: 'i' } },
      { 'gpa.optIn.studentName': { $regex: '12345', $options: 'i' } },
      { submissionIdInt: 12345 },
      { 'gpa.dpscd.studentNumber': 12345 }
    ] }, {}, {}] } })
    query.search = 'Ann.*'
    await handler({})
    expect(pipeline().find(stage => stage.$match?.$and)).toMatchObject({ $match: { $and: [{ $or: [
      { student: { $regex: 'Ann\\.\\*', $options: 'i' } },
      { 'gpa.dpscd.studentName': { $regex: 'Ann\\.\\*', $options: 'i' } },
      { 'gpa.optIn.studentName': { $regex: 'Ann\\.\\*', $options: 'i' } }
    ] }, {}, {}] } })
  })

  it('preserves missing and legacy status normalization before filtering', async () => {
    query.gpaStatus = 'Incomplete'
    await handler({})
    expect(pipeline().find(stage => stage.$set?.gpaStatus)?.$set?.gpaStatus).toEqual({
      $cond: [{ $eq: ['$gpaStatus', 'OOD Partial'] }, 'Opt-In Partial', { $ifNull: ['$gpaStatus', 'Incomplete'] }]
    })
  })

  it('supports no resolved source and bounds pagination', async () => {
    query = { ...query, source: 'none', page: '-1', limit: '99999' }
    mocks.collation.mockResolvedValue([{ records: [], count: [] }])
    expect(await handler({})).toEqual({ records: [], total: 0, page: 1, limit: 500 })
    expect(pipeline().find(stage => stage.$match?.$and)).toMatchObject({ $match: { $and: [{}, {}, { $or: [
      { 'gpa.resolvedSource': null }, { gpa: null }, { 'gpa.resolvedSource': { $exists: false } }
    ] }] } })
    expect(records()[0]).toEqual({ $sort: { student: 1, _id: 1 } })
  })

  it('requires authentication and a cycle and rejects arbitrary sort fields', async () => {
    query.sortBy = '$untrusted'
    await handler({})
    expect(records()[0]).toEqual({ $sort: { student: 1, _id: 1 } })
    query = {}
    await expect(handler({})).rejects.toMatchObject({ statusCode: 400 })
    expect(mocks.aggregate).toHaveBeenCalledTimes(1)
    vi.mocked(requireAuth).mockRejectedValueOnce(new Error('Unauthorized'))
    await expect(handler({})).rejects.toThrow('Unauthorized')
    expect(mocks.aggregate).toHaveBeenCalledTimes(1)
  })
})
