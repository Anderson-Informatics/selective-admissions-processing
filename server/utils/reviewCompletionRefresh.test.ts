import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CycleModel } from '../models/Cycle'
import { GpaRecordModel } from '../models/GpaRecord'
import { ReviewModel } from '../models/Review'
import { ReviewStageModel } from '../models/ReviewStage'
import { SubmissionModel } from '../models/Submission'
import { refreshReviewCompletion } from './reviewCompletionRefresh'

vi.mock('../models/Cycle', () => ({ CycleModel: { findById: vi.fn() } }))
vi.mock('../models/GpaRecord', () => ({ GpaRecordModel: { find: vi.fn(), bulkWrite: vi.fn() } }))
vi.mock('../models/Review', () => ({ ReviewModel: { find: vi.fn() } }))
vi.mock('../models/ReviewStage', () => ({ ReviewStageModel: { find: vi.fn() } }))
vi.mock('../models/Submission', () => ({
  SubmissionModel: { countDocuments: vi.fn(), distinct: vi.fn(), find: vi.fn(), bulkWrite: vi.fn() }
}))

describe('review completion GPA resolution', () => {
  const submission = {
    _id: 'id-1', cycleId: 'cycle-1', applicationId: 'app-1', submissionId: 'sub-1',
    mappedFields: {}, isMapped: true
  }
  let reviews: object[]
  let gpaRecords: object[]

  beforeEach(() => {
    vi.clearAllMocks()
    reviews = []
    gpaRecords = []
    vi.mocked(CycleModel.findById).mockReturnValue({ lean: async () => ({ rounds: [] }) } as never)
    vi.mocked(SubmissionModel.countDocuments).mockResolvedValue(1)
    vi.mocked(SubmissionModel.distinct).mockResolvedValue(['app-1'])
    vi.mocked(SubmissionModel.find).mockReturnValue({
      sort: () => ({ limit: () => ({ lean: async () => [submission] }) })
    } as never)
    vi.mocked(ReviewStageModel.find).mockReturnValue({
      lean: async () => [{ applicationId: 'app-1', stageId: 'recording', name: 'GPA Recording', role: 'work' }]
    } as never)
    vi.mocked(ReviewModel.find).mockReturnValue({ lean: async () => reviews } as never)
    vi.mocked(GpaRecordModel.find).mockReturnValue({ lean: async () => gpaRecords } as never)
    vi.mocked(GpaRecordModel.bulkWrite).mockResolvedValue({ modifiedCount: 1 } as never)
    vi.mocked(SubmissionModel.bulkWrite).mockResolvedValue({ modifiedCount: 1 } as never)
  })

  it('upserts even without an imported GPA, updates the resolution, and clears it when the review is removed', async () => {
    const run = async () => {
      await refreshReviewCompletion({ cycleId: 'cycle-1' })
      const gpaWrite = vi.mocked(GpaRecordModel.bulkWrite).mock.lastCall?.[0]?.[0] as {
        updateOne: { filter: object, update: { $set: object }, upsert: boolean }
      }
      const submissionWrite = vi.mocked(SubmissionModel.bulkWrite).mock.lastCall?.[0]?.[0] as unknown as {
        updateOne: { update: { $set: { gpaStatus: string } } }
      }
      return { gpaWrite, status: submissionWrite.updateOne.update.$set.gpaStatus }
    }

    expect(await run()).toMatchObject({
      gpaWrite: {
        updateOne: {
          filter: { cycleId: 'cycle-1', submissionId: 'sub-1' },
          update: { $set: { resolvedCumulativeGpa: null, resolvedSource: null } },
          upsert: true
        }
      },
      status: 'Incomplete'
    })

    reviews = [{
      stageId: 'recording', submissionId: 'sub-1', status: 'complete',
      completedAt: new Date('2026-10-21'), mappedData: { AbleToRecord: 'Yes', CumulativeGPA: 3.4 }
    }]
    expect(await run()).toMatchObject({
      gpaWrite: { updateOne: { update: { $set: { resolvedCumulativeGpa: 3.4, resolvedSource: 'recording' } } } },
      status: 'Complete'
    })

    reviews = []
    expect(await run()).toMatchObject({
      gpaWrite: { updateOne: { update: { $set: { resolvedCumulativeGpa: null, resolvedSource: null } } } },
      status: 'Incomplete'
    })
  })

  it('does not write resolution records or statuses on a dry run', async () => {
    const result = await refreshReviewCompletion({ cycleId: 'cycle-1', dryRun: true })
    expect(result.processed).toBe(1)
    expect(GpaRecordModel.bulkWrite).not.toHaveBeenCalled()
    expect(SubmissionModel.bulkWrite).not.toHaveBeenCalled()
  })

  it('preserves imported GPA fields when updating the resolved value', async () => {
    gpaRecords = [{
      submissionId: 'sub-1',
      dpscd: { cumulativeGpa: 3.2, quartersAvailable: 6 }
    }]
    await refreshReviewCompletion({ cycleId: 'cycle-1' })
    expect(vi.mocked(GpaRecordModel.bulkWrite).mock.lastCall?.[0]?.[0]).toMatchObject({
      updateOne: {
        update: {
          $set: { resolvedCumulativeGpa: 3.2, resolvedSource: 'dpscd' }
        }
      }
    })
    expect(vi.mocked(GpaRecordModel.bulkWrite).mock.lastCall?.[0]?.[0]).not.toHaveProperty('updateOne.update.$set.dpscd')
  })
})
