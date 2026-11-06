import { beforeEach, describe, expect, it, vi } from 'vitest'
import { JobModel } from '../models/Job'
import { runJob } from './jobs'
import { runRoutingBatches } from './routingBatches'

vi.mock('./routingBatches', () => ({ runRoutingBatches: vi.fn() }))

const job = { _id: 'job', type: 'run_routing', cycleId: 'cycle', createdBy: 'actor', payload: { scope: 'all' } } as never

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(JobModel, 'findByIdAndUpdate').mockResolvedValue({} as never)
  vi.spyOn(JobModel, 'create').mockResolvedValue({} as never)
})

describe('routing job continuation', () => {
  it('keeps a continuation pending without releasing its lock or queuing a follow-up', async () => {
    vi.mocked(runRoutingBatches).mockResolvedValue({ status: 'pending', result: { total: 501, processed: 250 } } as never)
    await expect(runJob(job)).resolves.toMatchObject({ status: 'pending' })
    expect(JobModel.create).not.toHaveBeenCalled()
    expect(JobModel.findByIdAndUpdate).toHaveBeenCalledWith('job', { $set: expect.objectContaining({ status: 'pending' }), $unset: { leaseExpiresAt: 1, error: 1, completedAt: 1 } })
  })

  it('releases its lock and queues the refresh only after all batches complete', async () => {
    vi.mocked(runRoutingBatches).mockResolvedValue({ status: 'completed', result: { total: 501, processed: 501 } } as never)
    await expect(runJob(job)).resolves.toMatchObject({ status: 'completed' })
    expect(JobModel.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'refresh_review_completion' }))
    expect(JobModel.findByIdAndUpdate).toHaveBeenCalledWith('job', expect.objectContaining({ $unset: { leaseExpiresAt: 1, error: 1, routingLock: 1 } }))
  })

  it('does not queue a follow-up for an uncertain failed batch', async () => {
    vi.mocked(runRoutingBatches).mockResolvedValue({ status: 'failed', result: { requiresReview: true } } as never)
    await expect(runJob(job)).resolves.toMatchObject({ status: 'failed' })
    expect(JobModel.create).not.toHaveBeenCalled()
  })
})
