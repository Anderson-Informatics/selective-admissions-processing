import { beforeEach, describe, expect, it, vi } from 'vitest'
import { JobModel } from '../models/Job'
import { leasePendingChildJobs } from './jobDispatcher'
import { updateParentJob } from './jobWorker'

vi.mock('./jobWorker', () => ({ updateParentJob: vi.fn() }))

beforeEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  vi.spyOn(JobModel, 'updateMany').mockResolvedValue({} as never)
  vi.spyOn(JobModel, 'find').mockReturnValue({ select: async () => [] } as never)
  vi.spyOn(JobModel, 'countDocuments').mockResolvedValue(0)
  vi.spyOn(JobModel, 'findOneAndUpdate').mockResolvedValue(null)
})

describe('job lease recovery', () => {
  it('requeues expired workers below the attempt limit', async () => {
    await leasePendingChildJobs(3)
    expect(JobModel.updateMany).toHaveBeenCalledWith(
      { status: 'running', leaseExpiresAt: { $lte: expect.any(Date) }, attempts: { $lt: 3 } },
      { $set: { status: 'pending', leaseExpiresAt: new Date(0), error: expect.stringContaining('retry') } }
    )
  })

  it('marks exhausted workers failed and refreshes each affected parent once', async () => {
    vi.mocked(JobModel.find).mockReturnValue({ select: async () => [
      { _id: 'child-1', parentJobId: 'parent-1' },
      { _id: 'child-2', parentJobId: 'parent-1' },
      { _id: 'standalone' }
    ] } as never)
    await leasePendingChildJobs(3, 16, 2)
    expect(JobModel.updateMany).toHaveBeenCalledWith(
      { _id: { $in: ['child-1', 'child-2', 'standalone'] } },
      { $set: { status: 'failed', completedAt: expect.any(Date), error: expect.stringContaining('maximum retry') }, $unset: { routingLock: 1 } }
    )
    expect(updateParentJob).toHaveBeenCalledExactlyOnceWith('parent-1')
  })

  it('does not lease additional work at the concurrency limit', async () => {
    vi.mocked(JobModel.countDocuments).mockResolvedValue(3)
    await expect(leasePendingChildJobs(3)).resolves.toEqual([])
    expect(JobModel.findOneAndUpdate).not.toHaveBeenCalled()
  })

  it('leases only available slots using an atomic pending-job claim', async () => {
    vi.mocked(JobModel.countDocuments).mockResolvedValue(2)
    vi.mocked(JobModel.findOneAndUpdate).mockResolvedValue({ _id: 'job-1' } as never)
    await expect(leasePendingChildJobs(3)).resolves.toEqual([{ _id: 'job-1' }])
    expect(JobModel.findOneAndUpdate).toHaveBeenCalledExactlyOnceWith(
      { status: 'pending', $or: [{ leaseExpiresAt: { $exists: false } }, { leaseExpiresAt: { $lte: expect.any(Date) } }] },
      { $set: { leaseExpiresAt: expect.any(Date) } },
      { sort: { createdAt: 1 }, returnDocument: 'after' }
    )
  })
})
