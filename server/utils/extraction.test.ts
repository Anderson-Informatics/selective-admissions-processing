import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FormEntryModel } from '../models/FormEntry'
import { ReviewModel } from '../models/Review'
import { SubmissionModel } from '../models/Submission'
import { extractFormSubmissions } from './extraction'
import { getCycleEntryContext } from './mappingStatus'
import { convertSubmissionIdsToInts, fetchEntriesForForm, fetchSubmissionsForProject, fetchV3SubmissionInts } from './submittable'

vi.mock('./mappingStatus', () => ({ getCycleEntryContext: vi.fn() }))
vi.mock('./submittable', () => ({
  convertSubmissionIdsToInts: vi.fn(), fetchEntriesForForm: vi.fn(), fetchSubmissionsForProject: vi.fn(), fetchV3SubmissionInts: vi.fn()
}))
const initial = { formType: 'initial', entry: { entryId: 'entry-1', submissionId: 'sub-1', projectId: 'project-1', formId: 'form-1', status: 'complete', fieldData: [] } }

beforeEach(() => {
  vi.restoreAllMocks()
  vi.resetAllMocks()
  vi.mocked(getCycleEntryContext).mockResolvedValue({
    applicationIdByProjectId: { 'project-1': 'app-1' },
    stageNameByFormAndProject: {},
    reviewStageByFormAndStage: {},
    reviewStageByApplicationAndStage: { 'app-1|stage-1': { stageName: 'Review' } }
  } as never)
  vi.mocked(fetchEntriesForForm).mockImplementation(async (_formId, onPage) => {
    await onPage?.([initial] as never, 1)
    return []
  })
  vi.mocked(fetchSubmissionsForProject).mockResolvedValue([{ submissionId: 'sub-1', reviewStageId: 'stage-1', status: 'active', labels: ['label-1'] }])
  vi.mocked(fetchV3SubmissionInts).mockResolvedValue([101])
  vi.mocked(convertSubmissionIdsToInts).mockResolvedValue(new Map([[101, 'sub-1'], [999, 'outside-cycle']]))
  vi.spyOn(FormEntryModel, 'bulkWrite').mockResolvedValue({} as never)
  vi.spyOn(ReviewModel, 'bulkWrite').mockResolvedValue({} as never)
  vi.spyOn(SubmissionModel, 'bulkWrite').mockResolvedValue({} as never)
})

describe('submission extraction', () => {
  it('upserts source entries and refreshes only encountered submissions', async () => {
    await expect(extractFormSubmissions('cycle-1', 'form-1')).resolves.toMatchObject({ entries: 1, submissionsStaged: 1, skippedEntries: 0 })
    expect(getCycleEntryContext).toHaveBeenCalledWith('cycle-1')
    expect(FormEntryModel.bulkWrite).toHaveBeenCalledWith([expect.objectContaining({ updateOne: expect.objectContaining({
      filter: { entryId: 'entry-1' }, upsert: true,
      update: { $set: expect.objectContaining({ cycleId: 'cycle-1', applicationId: 'app-1', isMapped: false, mappedData: {}, editingState: 'closed', editingCheckedAt: expect.any(Date) }), $unset: { openedForEditingAt: 1 } }
    }) })])
    expect(SubmissionModel.bulkWrite).toHaveBeenCalledWith([{ updateOne: {
      filter: { submissionId: 'sub-1' }, update: { $set: { currentStageId: 'stage-1', currentStageName: 'Review', status: 'active', labelIds: ['label-1'] } }
    } }])
    expect(SubmissionModel.bulkWrite).toHaveBeenLastCalledWith([{ updateOne: { filter: { cycleId: 'cycle-1', submissionId: 'sub-1' }, update: { $set: { submissionIdInt: 101 } } } }])
  })

  it('skips projects and review stages not configured for this cycle', async () => {
    vi.mocked(fetchEntriesForForm).mockImplementation(async (_formId, onPage) => {
      await onPage?.([
        { ...initial, entry: { ...initial.entry, projectId: 'another-project' } },
        { formType: 'review', entry: { entryId: 'review-1', stageId: 'another-stage' } }
      ] as never, 1)
      return []
    })
    await expect(extractFormSubmissions('cycle-1', 'form-1')).resolves.toMatchObject({ entries: 0, skippedEntries: 2 })
    expect(FormEntryModel.bulkWrite).not.toHaveBeenCalled()
    expect(ReviewModel.bulkWrite).not.toHaveBeenCalled()
    expect(SubmissionModel.bulkWrite).not.toHaveBeenCalled()
    expect(fetchSubmissionsForProject).not.toHaveBeenCalled()
  })

  it('uses stable upsert keys without overwriting HSPT or GPA links on repeat extraction', async () => {
    await extractFormSubmissions('cycle-1', 'form-1')
    await extractFormSubmissions('cycle-1', 'form-1')
    const calls = vi.mocked(SubmissionModel.bulkWrite).mock.calls
    expect(calls[3]![0]).toEqual(calls[0]![0])
    const operation = calls[0]![0][0] as { updateOne: { update: { $set: Record<string, unknown> } } }
    expect(operation.updateOne.update.$set).not.toHaveProperty('hsptResultId')
    expect(operation.updateOne.update.$set).not.toHaveProperty('gpaStatus')
  })

  it.each([
    ['editable', '2026-11-01T12:00:00Z', 'open'],
    ['editable', '2026-11-18T12:00:00Z', 'open'],
    ['complete', undefined, 'closed'],
    ['complete', '2026-11-01T12:00:00Z', 'closed'],
    ['unexpected', undefined, 'unknown'],
    ['editable', 'invalid', 'open']
  ])('persists %s metadata without inferring state from %s', async (status, openedForEditingAt, state) => {
    vi.mocked(fetchEntriesForForm).mockImplementation(async (_formId, onPage) => {
      await onPage?.([{ ...initial, entry: { ...initial.entry, status, openedForEditingAt } }] as never, 1)
      return []
    })
    await extractFormSubmissions('cycle-1', 'form-1')
    const operation = vi.mocked(FormEntryModel.bulkWrite).mock.calls[0]![0][0] as { updateOne: { update: { $set: Record<string, unknown>, $unset?: Record<string, unknown> } } }
    expect(operation.updateOne.update.$set).toMatchObject({ editingState: state, editingCheckedAt: expect.any(Date) })
    if (openedForEditingAt && openedForEditingAt !== 'invalid') {
      expect(operation.updateOne.update.$set.openedForEditingAt).toEqual(new Date(openedForEditingAt))
      expect(operation.updateOne.update.$unset).toBeUndefined()
    } else {
      expect(operation.updateOne.update.$unset).toEqual({ openedForEditingAt: 1 })
      expect(operation.updateOne.update.$set).not.toHaveProperty('openedForEditingAt')
    }
  })

  it('propagates extraction write failures before stage refresh', async () => {
    vi.mocked(FormEntryModel.bulkWrite).mockRejectedValueOnce(new Error('write failed'))
    await expect(extractFormSubmissions('cycle-1', 'form-1')).rejects.toThrow('write failed')
    expect(fetchSubmissionsForProject).not.toHaveBeenCalled()
  })
})
