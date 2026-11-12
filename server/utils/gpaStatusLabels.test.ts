import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApplicationModel } from '../models/Application'
import { SubmissionModel } from '../models/Submission'
import { addSubmissionLabelBulk, removeSubmissionLabel } from './submittable'
import { syncGpaStatusLabels } from './gpaStatusLabels'

vi.mock('../models/Application', () => ({ ApplicationModel: { find: vi.fn() } }))
vi.mock('../models/Submission', () => ({ SubmissionModel: { find: vi.fn(), bulkWrite: vi.fn() } }))
vi.mock('./submittable', () => ({ addSubmissionLabelBulk: vi.fn(), removeSubmissionLabel: vi.fn() }))

interface MockApplication { _id: string, name: string, scoring?: Record<string, unknown> }
interface MockSubmission { submissionId: string, applicationId: string, gpaStatus?: string, labelIds?: string[] }

function mockData(applications: MockApplication[], submissions: MockSubmission[]) {
  vi.mocked(ApplicationModel.find).mockReturnValue({
    select: () => ({ lean: async () => applications })
  } as never)
  vi.mocked(SubmissionModel.find).mockReturnValue({
    select: () => ({ lean: async () => submissions })
  } as never)
}

describe('syncGpaStatusLabels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(addSubmissionLabelBulk).mockResolvedValue(undefined)
    vi.mocked(removeSubmissionLabel).mockResolvedValue(undefined)
    vi.mocked(SubmissionModel.bulkWrite).mockResolvedValue({} as never)
  })

  it('keeps mappings isolated by application and removes only managed labels', async () => {
    mockData([
      { _id: 'app-a', name: 'App A', scoring: { gpaStatusLabels: { 'Complete': 'complete-a', 'Opt-In Partial': 'optin-partial-a' } } },
      { _id: 'app-b', name: 'App B', scoring: { gpaStatusLabels: { Complete: 'complete-b' } } }
    ], [
      { submissionId: 's1', applicationId: 'app-a', gpaStatus: 'Complete', labelIds: [] },
      { submissionId: 's2', applicationId: 'app-a', gpaStatus: 'OOD Partial', labelIds: ['optin-partial-a', 'other-label'] },
      { submissionId: 's3', applicationId: 'app-b', gpaStatus: 'Complete', labelIds: ['complete-a'] }
    ])

    const result = await syncGpaStatusLabels({ cycleId: 'cycle' })

    expect(addSubmissionLabelBulk).toHaveBeenNthCalledWith(1, ['s1'], 'complete-a', undefined)
    expect(addSubmissionLabelBulk).toHaveBeenNthCalledWith(2, ['s3'], 'complete-b', undefined)
    expect(removeSubmissionLabel).not.toHaveBeenCalled()
    expect(result.labelsAdded).toBe(2)
    expect(SubmissionModel.bulkWrite).toHaveBeenNthCalledWith(1, [
      expect.objectContaining({ updateOne: expect.objectContaining({ filter: expect.objectContaining({ submissionId: 's1' }), update: { $set: { labelIds: ['complete-a'] } } }) })
    ])
    expect(SubmissionModel.bulkWrite).toHaveBeenNthCalledWith(2, [
      expect.objectContaining({ updateOne: expect.objectContaining({ filter: expect.objectContaining({ submissionId: 's3' }), update: { $set: { labelIds: ['complete-a', 'complete-b'] } } }) })
    ])
  })

  it('canonicalizes legacy OOD Partial and replaces the old managed label', async () => {
    mockData([
      { _id: 'app-a', name: 'App A', scoring: { gpaStatusLabels: { 'Opt-In Partial': 'optin-new', 'Complete': 'optin-old' } } }
    ], [
      { submissionId: 's1', applicationId: 'app-a', gpaStatus: 'OOD Partial', labelIds: ['optin-old'] }
    ])

    const result = await syncGpaStatusLabels({ cycleId: 'cycle' })

    expect(addSubmissionLabelBulk).toHaveBeenCalledWith(['s1'], 'optin-new', undefined)
    expect(removeSubmissionLabel).toHaveBeenCalledWith('s1', 'optin-old', undefined)
    expect(result.labelsAdded).toBe(1)
    expect(result.labelsRemoved).toBe(1)
    expect(SubmissionModel.bulkWrite).toHaveBeenCalledWith([
      expect.objectContaining({ updateOne: expect.objectContaining({ update: { $set: { labelIds: ['optin-new'] } } }) })
    ])
  })

  it('skips unmapped statuses without touching labels', async () => {
    mockData([
      { _id: 'app-a', name: 'App A', scoring: { gpaStatusLabels: { Complete: 'complete-a' } } }
    ], [
      { submissionId: 's1', applicationId: 'app-a', gpaStatus: 'Partial', labelIds: ['unmanaged'] }
    ])

    const result = await syncGpaStatusLabels({ cycleId: 'cycle' })

    expect(addSubmissionLabelBulk).not.toHaveBeenCalled()
    expect(removeSubmissionLabel).not.toHaveBeenCalled()
    expect(SubmissionModel.bulkWrite).not.toHaveBeenCalled()
    expect(result.skipped).toBe(1)
  })

  it('rejects assigning one label to multiple statuses', async () => {
    mockData([
      { _id: 'app-a', name: 'App A', scoring: { gpaStatusLabels: { Complete: 'same-label', Partial: 'same-label' } } }
    ], [
      { submissionId: 's1', applicationId: 'app-a', gpaStatus: 'Complete', labelIds: [] }
    ])

    const result = await syncGpaStatusLabels({ cycleId: 'cycle' })

    expect(result.applicationsFailed).toBe(1)
    expect(result.failures[0]).toMatchObject({ operation: 'configuration', applicationId: 'app-a' })
    expect(addSubmissionLabelBulk).not.toHaveBeenCalled()
  })

  it('reports planned remote changes without writing during dry runs', async () => {
    mockData([
      { _id: 'app-a', name: 'App A', scoring: { gpaStatusLabels: { Complete: 'complete-a' } } }
    ], [
      { submissionId: 's1', applicationId: 'app-a', gpaStatus: 'Complete', labelIds: ['complete-a'] },
      { submissionId: 's2', applicationId: 'app-a', gpaStatus: 'Complete', labelIds: [] }
    ])

    const result = await syncGpaStatusLabels({ cycleId: 'cycle', dryRun: true })

    expect(result.labelsAdded).toBe(1)
    expect(result.unchanged).toBe(1)
    expect(addSubmissionLabelBulk).not.toHaveBeenCalled()
    expect(removeSubmissionLabel).not.toHaveBeenCalled()
    expect(SubmissionModel.bulkWrite).not.toHaveBeenCalled()
  })

  it('does not update local labels when the remote add fails', async () => {
    mockData([
      { _id: 'app-a', name: 'App A', scoring: { gpaStatusLabels: { Complete: 'complete-a' } } }
    ], [
      { submissionId: 's1', applicationId: 'app-a', gpaStatus: 'Complete', labelIds: [] }
    ])
    vi.mocked(addSubmissionLabelBulk).mockRejectedValue(new Error('Submittable unavailable'))

    const result = await syncGpaStatusLabels({ cycleId: 'cycle' })

    expect(result.failures).toHaveLength(1)
    expect(result.labelsAdded).toBe(0)
    expect(removeSubmissionLabel).not.toHaveBeenCalled()
    expect(SubmissionModel.bulkWrite).not.toHaveBeenCalled()
  })
})
