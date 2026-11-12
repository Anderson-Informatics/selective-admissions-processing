import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApplicationModel } from '../models/Application'
import { ReviewStageModel } from '../models/ReviewStage'
import { SubmissionModel } from '../models/Submission'
import { fetchSubmissionsForProject, removeSubmissionLabel } from './submittable'
import { clearWithdrawnStatusLabels } from './withdrawnStatusLabels'

vi.mock('../models/Application', () => ({ ApplicationModel: { find: vi.fn() } }))
vi.mock('../models/ReviewStage', () => ({ ReviewStageModel: { find: vi.fn() } }))
vi.mock('../models/Submission', () => ({ SubmissionModel: { find: vi.fn(), bulkWrite: vi.fn() } }))
vi.mock('./submittable', () => ({ fetchSubmissionsForProject: vi.fn(), removeSubmissionLabel: vi.fn() }))

const lean = (items: unknown[]) => ({ lean: async () => items })
const selectLean = (items: unknown[]) => ({ select: () => lean(items) })

function mockData({ applications = [], stages = [], submissions = [], remote = [] }: {
  applications?: unknown[]
  stages?: unknown[]
  submissions?: unknown[]
  remote?: unknown[]
}) {
  vi.mocked(ApplicationModel.find).mockReturnValue(selectLean(applications) as never)
  vi.mocked(ReviewStageModel.find).mockReturnValue(selectLean(stages) as never)
  vi.mocked(SubmissionModel.find).mockReturnValue(selectLean(submissions) as never)
  vi.mocked(fetchSubmissionsForProject).mockResolvedValue(remote as never)
}

describe('clearWithdrawnStatusLabels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(removeSubmissionLabel).mockResolvedValue(undefined)
    vi.mocked(SubmissionModel.bulkWrite).mockResolvedValue({} as never)
  })

  it('removes managed essay and GPA status labels while preserving unmanaged labels', async () => {
    mockData({
      applications: [{ _id: 'app-1', projectId: 'project-1', scoring: { gpaStatusLabels: { Complete: 'gpa-complete', Incomplete: 'gpa-incomplete' } } }],
      stages: [{ applicationId: 'app-1', routing: { statusLabels: { 'Needs Essay': 'essay-needs', 'Essay Complete': 'essay-done' } } }],
      submissions: [{ submissionId: 'sub-1', applicationId: 'app-1', projectId: 'project-1', status: 'Withdrawn', labelIds: ['essay-needs', 'gpa-complete', 'other-label'] }],
      remote: [{ submissionId: 'sub-1', labels: ['essay-needs', 'gpa-complete', 'other-label'] }]
    })

    const result = await clearWithdrawnStatusLabels({ cycleId: 'cycle-1' })

    expect(removeSubmissionLabel).toHaveBeenCalledWith('sub-1', 'essay-needs', undefined)
    expect(removeSubmissionLabel).toHaveBeenCalledWith('sub-1', 'gpa-complete', undefined)
    expect(removeSubmissionLabel).toHaveBeenCalledTimes(2)
    expect(result.labelsRemoved).toBe(2)
    expect(SubmissionModel.bulkWrite).toHaveBeenCalledWith([
      expect.objectContaining({ updateOne: expect.objectContaining({ update: { $set: { labelIds: ['other-label'] } } }) })
    ])
  })

  it('reports managed removals without touching Submittable or local labels in dry runs', async () => {
    mockData({
      applications: [{ _id: 'app-1', projectId: 'project-1', scoring: { gpaStatusLabels: { Complete: 'gpa-complete' } } }],
      stages: [],
      submissions: [{ submissionId: 'sub-1', applicationId: 'app-1', projectId: 'project-1', status: 'Withdrawn', labelIds: ['gpa-complete'] }],
      remote: [{ submissionId: 'sub-1', labels: ['gpa-complete'] }]
    })

    const result = await clearWithdrawnStatusLabels({ cycleId: 'cycle-1', dryRun: true })

    expect(result.labelsRemoved).toBe(1)
    expect(removeSubmissionLabel).not.toHaveBeenCalled()
    expect(SubmissionModel.bulkWrite).not.toHaveBeenCalled()
  })

  it('does not trust stale local labels or remove remotely when project labels cannot be loaded', async () => {
    mockData({
      applications: [{ _id: 'app-1', projectId: 'project-1', scoring: { gpaStatusLabels: { Complete: 'gpa-complete' } } }],
      stages: [],
      submissions: [{ submissionId: 'sub-1', applicationId: 'app-1', projectId: 'project-1', status: 'Withdrawn', labelIds: ['gpa-complete'] }]
    })
    vi.mocked(fetchSubmissionsForProject).mockRejectedValue(new Error('Submittable unavailable'))

    const result = await clearWithdrawnStatusLabels({ cycleId: 'cycle-1' })

    expect(result.failures).toEqual([expect.objectContaining({ submissionId: 'sub-1', error: 'Submittable unavailable' })])
    expect(removeSubmissionLabel).not.toHaveBeenCalled()
    expect(SubmissionModel.bulkWrite).not.toHaveBeenCalled()
  })
})
