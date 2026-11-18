import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GpaRecordModel } from '../models/GpaRecord'
import { MetadataModel } from '../models/Metadata'
import { SubmissionModel } from '../models/Submission'
import { addSubmissionLabelBulk, removeSubmissionLabel } from './submittable'
import { syncGpaBonusLabel } from './gpaBonusLabelSync'

vi.mock('../models/GpaRecord', () => ({ GpaRecordModel: { find: vi.fn() } }))
vi.mock('../models/Metadata', () => ({ MetadataModel: { findOne: vi.fn() } }))
vi.mock('../models/Submission', () => ({ SubmissionModel: { find: vi.fn(), bulkWrite: vi.fn() } }))
vi.mock('./submittable', () => ({ addSubmissionLabelBulk: vi.fn(), removeSubmissionLabel: vi.fn() }))

const LABEL = 'gpa-bonus-label'

function mockData({ submissions = [], gpa = [], labelId = LABEL }: {
  submissions?: Array<{ submissionId: string, status?: string, labelIds?: string[] }>
  gpa?: Array<{ submissionId: string, gpaBonusEligible?: boolean }>
  labelId?: string
}) {
  vi.mocked(MetadataModel.findOne).mockReturnValue({
    select: () => ({ lean: async () => (labelId ? { externalId: labelId, name: 'GPA Bonus Eligible' } : undefined) })
  } as never)
  vi.mocked(SubmissionModel.find).mockReturnValue({
    select: () => ({ lean: async () => submissions })
  } as never)
  vi.mocked(GpaRecordModel.find).mockReturnValue({
    select: () => ({ lean: async () => gpa })
  } as never)
}

describe('syncGpaBonusLabel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(addSubmissionLabelBulk).mockResolvedValue([])
    vi.mocked(removeSubmissionLabel).mockResolvedValue(undefined)
    vi.mocked(SubmissionModel.bulkWrite).mockResolvedValue({} as never)
  })

  it('adds the label to newly eligible submissions and removes it from ineligible ones', async () => {
    mockData({
      submissions: [
        { submissionId: 'new', labelIds: [] },
        { submissionId: 'stale', labelIds: [LABEL, 'other'] },
        { submissionId: 'kept', labelIds: [LABEL] }
      ],
      gpa: [
        { submissionId: 'new', gpaBonusEligible: true },
        { submissionId: 'stale', gpaBonusEligible: false },
        { submissionId: 'kept', gpaBonusEligible: true }
      ]
    })

    const result = await syncGpaBonusLabel({ cycleId: 'c1' })

    expect(addSubmissionLabelBulk).toHaveBeenCalledWith(['new'], LABEL, undefined)
    expect(removeSubmissionLabel).toHaveBeenCalledWith('stale', LABEL, undefined)
    expect(removeSubmissionLabel).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ labelResolved: true, eligible: 2, labelsAdded: 1, labelsRemoved: 1, unchanged: 1 })
    expect(SubmissionModel.bulkWrite).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ updateOne: expect.objectContaining({ filter: { cycleId: 'c1', submissionId: 'new' }, update: { $set: { labelIds: [LABEL] } } }) }),
      expect.objectContaining({ updateOne: expect.objectContaining({ filter: { cycleId: 'c1', submissionId: 'stale' }, update: { $set: { labelIds: ['other'] } } }) })
    ]))
  })

  it('strips the label from withdrawn submissions', async () => {
    mockData({
      submissions: [{ submissionId: 'w1', status: 'Withdrawn', labelIds: [LABEL] }],
      gpa: [{ submissionId: 'w1', gpaBonusEligible: true }]
    })

    const result = await syncGpaBonusLabel({ cycleId: 'c1' })

    expect(removeSubmissionLabel).toHaveBeenCalledWith('w1', LABEL, undefined)
    expect(result.labelsRemoved).toBe(1)
    expect(result.eligible).toBe(0)
  })

  it('reports planned changes without writing in dry run', async () => {
    mockData({
      submissions: [{ submissionId: 'new', labelIds: [] }],
      gpa: [{ submissionId: 'new', gpaBonusEligible: true }]
    })

    const result = await syncGpaBonusLabel({ cycleId: 'c1', dryRun: true })

    expect(result).toMatchObject({ dryRun: true, labelsAdded: 1 })
    expect(addSubmissionLabelBulk).not.toHaveBeenCalled()
    expect(removeSubmissionLabel).not.toHaveBeenCalled()
    expect(SubmissionModel.bulkWrite).not.toHaveBeenCalled()
  })

  it('does not mirror label changes locally when Submittable leaves a submission unapplied', async () => {
    mockData({
      submissions: [{ submissionId: 'new', labelIds: [] }],
      gpa: [{ submissionId: 'new', gpaBonusEligible: true }]
    })
    vi.mocked(addSubmissionLabelBulk).mockResolvedValue(['new'])

    const result = await syncGpaBonusLabel({ cycleId: 'c1' })

    expect(result.labelsAdded).toBe(0)
    expect(result.failures).toEqual([{ submissionId: 'new', operation: 'add', error: 'Submittable did not confirm the label' }])
    expect(SubmissionModel.bulkWrite).not.toHaveBeenCalled()
  })

  it('skips entirely when the bonus label cannot be resolved', async () => {
    mockData({ submissions: [{ submissionId: 's', labelIds: [] }], labelId: '' })

    const result = await syncGpaBonusLabel({ cycleId: 'c1' })

    expect(result.labelResolved).toBe(false)
    expect(SubmissionModel.find).not.toHaveBeenCalled()
    expect(addSubmissionLabelBulk).not.toHaveBeenCalled()
  })
})
