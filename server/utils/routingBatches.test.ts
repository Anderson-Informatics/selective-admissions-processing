import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runRoutingBatches } from './routingBatches'
import { executeRoutingRun } from './routingExecutor'
import { JobModel } from '../models/Job'
import { RoutingBatchModel } from '../models/RoutingBatch'
import { SubmissionModel } from '../models/Submission'

vi.mock('./routingExecutor', () => ({ executeRoutingRun: vi.fn() }))
vi.mock('../models/Job', () => ({ JobModel: { updateOne: vi.fn() } }))
vi.mock('../models/RoutingBatch', () => ({ RoutingBatchModel: { exists: vi.fn(), updateOne: vi.fn(), findOne: vi.fn(), findOneAndUpdate: vi.fn(), find: vi.fn() } }))
vi.mock('../models/Submission', () => ({ SubmissionModel: { find: vi.fn() } }))

interface Batch { _id: string, index: number, submissionIds: string[], status: string, result?: unknown }
let batches: Batch[]
let submissions: Array<{ submissionId: string }>
let job: { _id: string, cycleId: string, createdBy: string, payload: { scope: 'all' | 'limited', routingInitialized?: boolean, limit?: number, dryRun: boolean, applicationId: string, labelId: string } }

async function* iterate<T>(items: T[]) {
  yield* items
}

beforeEach(() => {
  vi.clearAllMocks()
  batches = []
  submissions = []
  job = { _id: 'job', cycleId: 'cycle', createdBy: 'actor', payload: { scope: 'all', dryRun: true, applicationId: 'app', labelId: 'label' } }
  vi.mocked(SubmissionModel.find).mockImplementation(() => ({ sort: () => ({ select: () => ({ lean: () => ({ cursor: () => iterate(submissions) }) }) }) }) as never)
  vi.mocked(JobModel.updateOne).mockImplementation((_filter, update) => {
    if ((update as { $set?: Record<string, unknown> }).$set?.['payload.routingInitialized']) job.payload.routingInitialized = true
    return Promise.resolve({}) as never
  })
  vi.mocked(RoutingBatchModel.exists).mockImplementation(() => Promise.resolve(batches.length ? {} : null) as never)
  vi.mocked(RoutingBatchModel.updateOne).mockImplementation((filter, update) => {
    const query = filter as { index?: number, _id?: string }
    const change = update as { $setOnInsert?: { submissionIds: string[] }, $set?: object }
    if (change.$setOnInsert) batches.push({ _id: String(query.index), index: query.index!, submissionIds: [...change.$setOnInsert.submissionIds], status: 'pending' })
    else Object.assign(batches.find(batch => batch._id === query._id)!, change.$set)
    return Promise.resolve({}) as never
  })
  vi.mocked(RoutingBatchModel.findOne).mockImplementation(() => ({ lean: async () => batches.find(batch => batch.status === 'running') }) as never)
  vi.mocked(RoutingBatchModel.findOneAndUpdate).mockImplementation(() => {
    const batch = batches.find(batch => batch.status === 'pending')
    if (batch) batch.status = 'running'
    return Promise.resolve(batch) as never
  })
  vi.mocked(RoutingBatchModel.find).mockImplementation(() => ({ select: () => ({ lean: () => ({ cursor: () => iterate(batches) }) }) }) as never)
  vi.mocked(executeRoutingRun).mockImplementation(async options => ({ evaluated: options.submissionIds!.length, moves: 0, noAction: options.submissionIds!.length, failures: [] }) as never)
})

describe('routing batches', () => {
  it.each([501, 2001, 5001])('evaluates all %i original submissions in bounded resumable batches', async (count) => {
    submissions = Array.from({ length: count }, (_, index) => ({ submissionId: `sub-${index}` }))
    let output
    do {
      output = await runRoutingBatches(job as never)
    } while (output.status === 'pending')
    expect(output).toMatchObject({ status: 'completed', result: { total: count, evaluated: count, noAction: count } })
    const calls = vi.mocked(executeRoutingRun).mock.calls.map(([options]) => options)
    expect(calls.every(options => options.submissionIds!.length <= 250 && options.dryRun === true && !options.labelId)).toBe(true)
    expect(calls.flatMap(options => options.submissionIds)).toEqual(submissions.map(item => item.submissionId))
    expect(SubmissionModel.find).toHaveBeenCalledTimes(1)
    expect(SubmissionModel.find).toHaveBeenCalledWith({ cycleId: 'cycle', applicationId: 'app', labelIds: 'label' })
  })

  it('snapshots all essay-stage submissions and resumes without selecting again', async () => {
    submissions = Array.from({ length: 501 }, (_, index) => ({ submissionId: `essay-${index}` }))
    const selected = submissions.map(item => item.submissionId)
    expect(await runRoutingBatches(job as never, undefined, 'essay-stage')).toMatchObject({ status: 'pending', result: { processed: 250 } })
    expect(SubmissionModel.find).toHaveBeenCalledWith({ cycleId: 'cycle', applicationId: 'app', labelIds: 'label', currentStageId: 'essay-stage' })
    submissions = []
    expect(await runRoutingBatches(job as never, undefined, 'essay-stage')).toMatchObject({ status: 'pending', result: { processed: 500 } })
    expect(await runRoutingBatches(job as never, undefined, 'essay-stage')).toMatchObject({ status: 'completed', result: { total: 501, processed: 501 } })
    expect(SubmissionModel.find).toHaveBeenCalledTimes(1)
    expect(vi.mocked(executeRoutingRun).mock.calls.flatMap(([options]) => options.submissionIds)).toEqual(selected)
  })

  it('handles an empty selection', async () => {
    expect(await runRoutingBatches(job as never)).toMatchObject({ status: 'completed', result: { total: 0 } })
    expect(executeRoutingRun).not.toHaveBeenCalled()
  })

  it('preserves limited scope', async () => {
    job.payload.scope = 'limited'
    job.payload.limit = 2
    submissions = Array.from({ length: 5 }, (_, index) => ({ submissionId: String(index) }))
    expect(await runRoutingBatches(job as never)).toMatchObject({ status: 'completed', result: { total: 2 } })
  })

  it('does not replay an interrupted external-write batch', async () => {
    job.payload.routingInitialized = true
    batches.push({ _id: '0', index: 0, submissionIds: ['sub'], status: 'running' })
    expect(await runRoutingBatches(job as never)).toMatchObject({ status: 'failed', result: { requiresReview: true, submissionIds: ['sub'] } })
    expect(executeRoutingRun).not.toHaveBeenCalled()
  })

  it('does not reuse an incomplete selection manifest', async () => {
    batches.push({ _id: '0', index: 0, submissionIds: ['sub'], status: 'pending' })
    expect(await runRoutingBatches(job as never)).toMatchObject({ status: 'failed', result: { requiresReview: true } })
    expect(executeRoutingRun).not.toHaveBeenCalled()
  })
})
