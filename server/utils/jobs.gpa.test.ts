import { beforeEach, describe, expect, it, vi } from 'vitest'
import { JobModel } from '../models/Job'
import { importDpscdGpaRecords } from './gpa'
import { syncGpaStatusLabels } from './gpaStatusLabels'
import { refreshReviewCompletion } from './reviewCompletionRefresh'
import { runJob } from './jobs'

vi.mock('./gpa', () => ({ importDpscdGpaRecords: vi.fn(), commitOptInGpaUpload: vi.fn(), previewOptInGpaUpload: vi.fn() }))
vi.mock('./gpaStatusLabels', () => ({ syncGpaStatusLabels: vi.fn() }))
vi.mock('./reviewCompletionRefresh', () => ({ refreshReviewCompletion: vi.fn() }))

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(JobModel, 'findById').mockReturnValue({ select: () => ({ lean: async () => ({ progress: {} }) }) } as never)
  vi.spyOn(JobModel, 'findByIdAndUpdate').mockResolvedValue({} as never)
  vi.spyOn(JobModel, 'create').mockResolvedValue({} as never)
  vi.mocked(importDpscdGpaRecords).mockResolvedValue({ processed: 1, matched: 1, inserted: 0, updated: 0, unmatched: 0, warnings: [], errors: [] })
  vi.mocked(refreshReviewCompletion).mockResolvedValue({ processed: 1, updated: 1, dryRun: false, diagnostics: [] } as never)
  vi.mocked(syncGpaStatusLabels).mockResolvedValue({ dryRun: false, applications: 1, applicationsSkipped: 0, applicationsFailed: 0, submissions: 1, labelsAdded: 1, labelsRemoved: 0, unchanged: 0, skipped: 0, failures: [] })
})

describe('DPSCD import jobs', () => {
  it.each([true, false])('only queues completion refresh for a real import (dryRun=%s)', async (dryRun) => {
    await runJob({ _id: 'j1', type: 'dpscd_gpa_import', cycleId: 'c1', payload: { uploadId: 'u1', dryRun } } as never)
    expect(importDpscdGpaRecords).toHaveBeenCalledWith('u1', 'j1', expect.any(Function), dryRun)
    if (dryRun) expect(JobModel.create).not.toHaveBeenCalled()
    else expect(JobModel.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'refresh_review_completion', cycleId: 'c1' }))
  })
})

describe('GPA status label jobs', () => {
  it.each([true, false])('syncs GPA labels only after a real review-completion refresh (dryRun=%s)', async (dryRun) => {
    await runJob({ _id: 'j2', type: 'refresh_review_completion', cycleId: 'c1', createdBy: 'tester', payload: { dryRun } } as never)
    if (dryRun) expect(syncGpaStatusLabels).not.toHaveBeenCalled()
    else expect(syncGpaStatusLabels).toHaveBeenCalledWith(expect.objectContaining({ cycleId: 'c1' }))
  })

  it('runs the standalone GPA label sync with its payload', async () => {
    await runJob({ _id: 'j3', type: 'gpa_status_label_sync', cycleId: 'c1', createdBy: 'tester', payload: { applicationId: 'app-a', dryRun: true } } as never)
    expect(syncGpaStatusLabels).toHaveBeenCalledWith(expect.objectContaining({ cycleId: 'c1', applicationId: 'app-a', dryRun: true }))
  })
})
