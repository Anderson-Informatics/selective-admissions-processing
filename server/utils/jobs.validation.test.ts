import { beforeEach, describe, expect, it, vi } from 'vitest'
import { JobModel } from '../models/Job'
import { runJob } from './jobs'
import { runValidationForCycle } from './validation'
import { reconcileValidationLabelsForCycle } from './validationLabels'

vi.mock('./validation', () => ({ runValidationForCycle: vi.fn() }))
vi.mock('./validationLabels', () => ({ reconcileValidationLabelsForCycle: vi.fn() }))

const job = { _id: 'job-1', type: 'run_validation', cycleId: 'cycle-1' } as never
const submittable = { apiKey: 'test' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(JobModel, 'findById').mockImplementation(() => ({
    select: () => ({ lean: async () => ({ progress: {} }) })
  }) as never)
  vi.spyOn(JobModel, 'findByIdAndUpdate').mockResolvedValue({} as never)
  vi.mocked(runValidationForCycle).mockResolvedValue({ total: 2, created: 1, resolved: 1 })
  vi.mocked(reconcileValidationLabelsForCycle).mockResolvedValue({ added: 1, removed: 1 })
})

describe('run validation job labels', () => {
  it('synchronizes after issue validation and includes label changes in the result', async () => {
    const result = await runJob(job, { submittable })
    expect(runValidationForCycle).toHaveBeenCalledWith('cycle-1', expect.any(Function))
    expect(reconcileValidationLabelsForCycle).toHaveBeenCalledWith('cycle-1', submittable)
    expect(vi.mocked(runValidationForCycle).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(reconcileValidationLabelsForCycle).mock.invocationCallOrder[0]!)
    expect(result).toMatchObject({ status: 'completed', result: { total: 2, labels: { added: 1, removed: 1 } } })
  })

  it('fails the job if remote label synchronization fails', async () => {
    vi.mocked(reconcileValidationLabelsForCycle).mockRejectedValueOnce(new Error('remote failed'))
    await expect(runJob(job, { submittable })).rejects.toThrow('remote failed')
    expect(JobModel.findByIdAndUpdate).toHaveBeenCalledWith('job-1', expect.objectContaining({ $set: expect.objectContaining({ status: 'failed' }) }))
  })
})
