import { beforeEach, describe, expect, it, vi } from 'vitest'
import { JobModel } from '../models/Job'
import { importDpscdGpaRecords } from './gpa'
import { runJob } from './jobs'

vi.mock('./gpa', () => ({ importDpscdGpaRecords: vi.fn(), commitOptInGpaUpload: vi.fn(), previewOptInGpaUpload: vi.fn() }))

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(JobModel, 'findById').mockReturnValue({ select: () => ({ lean: async () => ({ progress: {} }) }) } as never)
  vi.spyOn(JobModel, 'findByIdAndUpdate').mockResolvedValue({} as never)
  vi.spyOn(JobModel, 'create').mockResolvedValue({} as never)
  vi.mocked(importDpscdGpaRecords).mockResolvedValue({ processed: 1, matched: 1, inserted: 0, updated: 0, unmatched: 0, warnings: [], errors: [] })
})

describe('DPSCD import jobs', () => {
  it.each([true, false])('only queues completion refresh for a real import (dryRun=%s)', async (dryRun) => {
    await runJob({ _id: 'j1', type: 'dpscd_gpa_import', cycleId: 'c1', payload: { uploadId: 'u1', dryRun } } as never)
    expect(importDpscdGpaRecords).toHaveBeenCalledWith('u1', 'j1', expect.any(Function), dryRun)
    if (dryRun) expect(JobModel.create).not.toHaveBeenCalled()
    else expect(JobModel.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'refresh_review_completion', cycleId: 'c1' }))
  })
})
