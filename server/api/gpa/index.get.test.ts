import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ aggregate: vi.fn(), collation: vi.fn(), findOne: vi.fn(), findApplications: vi.fn() }))
vi.mock('~~/server/models/Application', () => ({ ApplicationModel: { find: mocks.findApplications } }))
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
  mocks.findApplications.mockReturnValue({ select: () => ({ lean: async () => [] }) })
  mocks.aggregate.mockImplementation((pipeline: Array<Record<string, unknown>>) => pipeline.some(stage => stage.$group) ? Promise.resolve([]) : { collation: mocks.collation })
  mocks.collation.mockResolvedValue([{ records: [{ _id: 'sub-1' }], count: [{ total: 75 }] }])
})

interface PipelineStage {
  $lookup?: { as?: string }
  $match?: { $and?: unknown[] }
  $facet?: { records: Record<string, unknown>[] }
  [key: string]: unknown
}

function pipeline() {
  return mocks.aggregate.mock.calls
    .map(call => call[0] as PipelineStage[])
    .filter(stages => !stages.some(stage => stage.$group))
    .at(-1)!
}

function duplicatePipeline() {
  return mocks.aggregate.mock.calls
    .map(call => call[0] as PipelineStage[])
    .find(stages => stages.some(stage => stage.$group))!
}

describe('GET /api/gpa', () => {
  it('starts with every submission and looks up GPA plus review sources before filtering', async () => {
    query = { ...query, gpaStatus: 'OOD Partial', source: 'optIn', page: '2', limit: '50', sortBy: 'resolvedCumulativeGpa', sortOrder: 'desc' }
    expect(await handler({})).toEqual({ records: [{ _id: 'sub-1' }], total: 75, page: 2, limit: 50, duplicateStudentNumbers: [] })
    const stages = pipeline()
    expect(stages[0]).toEqual({ $match: { cycleId: 'cycle-1', status: { $not: /^withdrawn$/i } } })
    expect(stages.filter(stage => stage.$lookup).map(stage => stage.$lookup?.as)).toEqual(['_gpa', '_recordingReviews', '_partialReviews'])
    expect(stages.find(stage => stage.$match?.$and)).toMatchObject({ $match: { $and: [
      {}, { gpaStatus: 'Opt-In Partial' }, { 'gpa.resolvedSource': 'optIn' }
    ] } })
    expect(stages.at(-1)?.$facet?.records).toContainEqual({ $sort: { resolvedCumulativeGpa: -1, _id: 1 } })
    expect(stages.at(-1)?.$facet?.records).toContainEqual({ $skip: 50 })
  })

  it('searches names and exact integer identifiers, escaping regex input', async () => {
    query = { ...query, search: '12345' }
    await handler({})
    expect(pipeline().find(stage => stage.$match?.$and)).toMatchObject({ $match: { $and: [{ $or: [
      { student: { $regex: '12345', $options: 'i' } },
      { 'gpa.dpscd.studentName': { $regex: '12345', $options: 'i' } },
      { 'gpa.optIn.studentName': { $regex: '12345', $options: 'i' } },
      { submissionIdInt: 12345 },
      { 'gpa.dpscd.studentNumber': 12345 }
    ] }, {}, {}] } })

    query = { ...query, search: 'Ann.*' }
    await handler({})
    expect(pipeline().find(stage => stage.$match?.$and)).toMatchObject({ $match: { $and: [{ $or: [
      { student: { $regex: 'Ann\\.\\*', $options: 'i' } },
      { 'gpa.dpscd.studentName': { $regex: 'Ann\\.\\*', $options: 'i' } },
      { 'gpa.optIn.studentName': { $regex: 'Ann\\.\\*', $options: 'i' } }
    ] }, {}, {}] } })
  })

  it('supports no resolved source, defaults to student sorting, and bounds pagination', async () => {
    query = { ...query, source: 'none', page: '-1', limit: '99999' }
    mocks.collation.mockResolvedValue([{ records: [], count: [] }])
    expect(await handler({})).toEqual({ records: [], total: 0, page: 1, limit: 500, duplicateStudentNumbers: [] })
    const stages = pipeline()
    expect(stages.find(stage => stage.$match?.$and)).toMatchObject({ $match: { $and: [{}, {}, { $or: [
      { 'gpa.resolvedSource': null }, { gpa: null }, { 'gpa.resolvedSource': { $exists: false } }
    ] }] } })
    expect(stages.at(-1)?.$facet?.records[0]).toEqual({ $sort: { student: 1, _id: 1 } })
  })

  it('reports duplicate mapped student numbers independently of GPA filters', async () => {
    query = { ...query, gpaStatus: 'Complete', source: 'dpscd', search: '999', page: '2' }
    mocks.aggregate.mockImplementation((pipeline: Array<Record<string, unknown>>) => pipeline.some(stage => stage.$group)
      ? Promise.resolve([
          { studentNumber: '12345', duplicateCount: 2, submissionId: 'guid-1', submissionIdInt: 111, applicationId: 'app-1', student: 'Student One', status: 'Submitted', currentStageName: 'Review', gpaStatus: 'OOD Partial', resolvedCumulativeGpa: 3.5, resolvedSource: 'dpscd', dpscdStudentName: 'PowerSchool One', dpscdStudentNumber: 12345 },
          { studentNumber: '12345', duplicateCount: 2, submissionId: 'guid-2', submissionIdInt: 222, applicationId: 'app-1', student: 'Student Two', status: 'Submitted', currentStageName: 'Review', gpaStatus: 'Complete', resolvedCumulativeGpa: 3.5, resolvedSource: 'dpscd', dpscdStudentName: 'PowerSchool One', dpscdStudentNumber: 12345 }
        ])
      : { collation: mocks.collation })
    mocks.findApplications.mockReturnValue({ select: () => ({ lean: async () => [{ _id: 'app-1', name: 'Application A' }] }) })

    const response = await handler({}) as { duplicateStudentNumbers: Array<Record<string, unknown>> }

    expect(response.duplicateStudentNumbers).toHaveLength(2)
    expect(response.duplicateStudentNumbers[0]).toMatchObject({ studentNumber: '12345', duplicateCount: 2, applicationName: 'Application A', gpaStatus: 'Opt-In Partial' })
    const stages = duplicatePipeline()
    expect(stages[0]).toEqual({ $match: { cycleId: 'cycle-1' } })
    expect(stages.some(stage => stage.$group)).toBe(true)
    expect(stages).toContainEqual({ $match: { duplicateCount: { $gt: 1 } } })
    expect(stages.some(stage => stage.$match?.$and)).toBe(false)
  })

  it('requires a cycle and rejects arbitrary sort fields', async () => {
    query = { ...query, sortBy: '$untrusted' }
    await handler({})
    expect(pipeline().at(-1)?.$facet?.records[0]).toEqual({ $sort: { student: 1, _id: 1 } })
    query = {}
    await expect(handler({})).rejects.toMatchObject({ statusCode: 400 })
    expect(mocks.aggregate).toHaveBeenCalledTimes(2)
  })
})
