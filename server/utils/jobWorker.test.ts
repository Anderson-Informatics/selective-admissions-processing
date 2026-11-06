import mongoose from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JobModel } from '../models/Job'
import { HSPTUploadModel } from '../models/HSPTUpload'
import { GpaUploadModel } from '../models/GpaUpload'
import { runJob } from './jobs'
import { processQueuedJob, updateParentJob } from './jobWorker'

vi.mock('./jobs', () => ({ runJob: vi.fn() }))
const config = { mongodbUri: 'mongodb://example.test/fixture', submittable: { apiKey: 'fixture' }, maxAttempts: 3 }

beforeEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  vi.spyOn(mongoose, 'connect').mockResolvedValue(mongoose)
  vi.spyOn(JobModel, 'findOneAndUpdate').mockResolvedValue(null)
  vi.spyOn(JobModel, 'findByIdAndUpdate').mockResolvedValue(null)
  vi.spyOn(HSPTUploadModel, 'updateOne').mockResolvedValue({} as never)
  vi.spyOn(GpaUploadModel, 'updateOne').mockResolvedValue({} as never)
})

afterEach(() => vi.useRealTimers())

describe('job worker', () => {
  it('does not execute a duplicate or unleased delivery', async () => {
    await expect(processQueuedJob('job-1', config)).resolves.toEqual({ claimed: false })
    expect(runJob).not.toHaveBeenCalled()
    expect(JobModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'job-1', status: 'pending', leaseExpiresAt: { $gt: expect.any(Date) } },
      { $set: { status: 'running', startedAt: expect.any(Date), error: undefined }, $inc: { attempts: 1 } },
      { returnDocument: 'after' }
    )
  })

  it('requeues a failed attempt and clears its heartbeat', async () => {
    vi.useFakeTimers()
    vi.mocked(JobModel.findOneAndUpdate).mockResolvedValue({ _id: 'job-1', attempts: 1 } as never)
    vi.mocked(runJob).mockRejectedValueOnce(new Error('temporary failure'))
    await expect(processQueuedJob('job-1', config)).resolves.toEqual({ claimed: true })
    expect(JobModel.findByIdAndUpdate).toHaveBeenCalledWith('job-1', { $set: {
      status: 'pending', error: 'temporary failure', completedAt: undefined, leaseExpiresAt: new Date(0)
    } })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not requeue an exhausted attempt', async () => {
    vi.mocked(JobModel.findOneAndUpdate).mockResolvedValue({ _id: 'job-1', attempts: 3 } as never)
    vi.mocked(runJob).mockRejectedValueOnce(new Error('permanent failure'))
    await processQueuedJob('job-1', config)
    expect(JobModel.findByIdAndUpdate).not.toHaveBeenCalled()
  })

  it('releases the cycle routing lock after exhausted retries', async () => {
    vi.spyOn(JobModel, 'updateOne').mockResolvedValue({} as never)
    vi.mocked(JobModel.findOneAndUpdate).mockResolvedValue({ _id: 'job-1', attempts: 3, routingLock: 'cycle-1' } as never)
    vi.mocked(runJob).mockRejectedValueOnce(new Error('permanent failure'))
    await processQueuedJob('job-1', config)
    expect(JobModel.updateOne).toHaveBeenCalledWith({ _id: 'job-1' }, { $unset: { routingLock: 1 } })
  })

  it.each([
    ['hspt_upload_preview', HSPTUploadModel, 'previewJobId', 'previewing'],
    ['hspt_upload_commit', HSPTUploadModel, 'commitJobId', 'confirming'],
    ['dpscd_gpa_import', GpaUploadModel, 'importJobId', 'importing'],
    ['optin_gpa_preview', GpaUploadModel, 'previewJobId', 'previewing'],
    ['optin_gpa_commit', GpaUploadModel, 'commitJobId', 'confirming']
  ] as const)('restores a failed %s upload only for its recorded retry job', async (type, model, jobField, status) => {
    vi.mocked(JobModel.findOneAndUpdate).mockResolvedValue({
      _id: 'job-1', cycleId: 'cycle-1', attempts: 2, type, payload: { uploadId: 'upload-1' }
    } as never)
    await processQueuedJob('job-1', config)
    expect(model.updateOne).toHaveBeenCalledExactlyOnceWith(
      { _id: 'upload-1', cycleId: 'cycle-1', [jobField]: 'job-1', status: 'failed' },
      { $set: { status, error: undefined } }
    )
    expect(vi.mocked(model.updateOne).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(runJob).mock.invocationCallOrder[0]!)
  })

  it('does not reset upload status on the first attempt', async () => {
    vi.mocked(JobModel.findOneAndUpdate).mockResolvedValue({
      _id: 'job-1', cycleId: 'cycle-1', attempts: 1, type: 'hspt_upload_commit', payload: { uploadId: 'upload-1' }
    } as never)
    await processQueuedJob('job-1', config)
    expect(HSPTUploadModel.updateOne).not.toHaveBeenCalled()
    expect(GpaUploadModel.updateOne).not.toHaveBeenCalled()
  })

  it('aggregates child progress and records partial failure on the parent', async () => {
    vi.spyOn(JobModel, 'findById').mockReturnValue({ lean: async () => ({ result: { retained: true } }) } as never)
    vi.spyOn(JobModel, 'find').mockReturnValue({ sort: () => ({ lean: async () => [
      { _id: 'child-1', formId: 'form-1', status: 'completed', result: { entries: 10 } },
      { _id: 'child-2', formId: 'form-2', status: 'failed', error: 'upstream unavailable' }
    ] }) } as never)
    await updateParentJob('parent-1')
    expect(JobModel.find).toHaveBeenCalledWith({ parentJobId: 'parent-1' })
    expect(JobModel.findByIdAndUpdate).toHaveBeenCalledWith('parent-1', { $set: expect.objectContaining({
      status: 'failed', result: expect.objectContaining({ retained: true, entries: 10 }),
      progress: expect.objectContaining({ processed: 1, total: 2, percent: 50 }), completedAt: expect.any(Date)
    }) })
  })
})
