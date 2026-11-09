import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runEssayFinishScoring } from './essayScoring'
import { runRoutingBatches } from './routingBatches'
import { extractFormSubmissions } from './extraction'
import { mapFormResponsesForCycle } from './responseMapping'
import { refreshReviewCompletion } from './reviewCompletionRefresh'
import { evaluateCycleSubmissions } from './routingRun'
import { buildEssayExport } from './essayExport'
import { ApplicationModel } from '../models/Application'
import { ReviewStageModel } from '../models/ReviewStage'
import { SubmissionModel } from '../models/Submission'
import { ReviewModel } from '../models/Review'
import { RoutingBatchModel } from '../models/RoutingBatch'
import { JobModel } from '../models/Job'

vi.mock('./routingBatches', () => ({ runRoutingBatches: vi.fn() }))
vi.mock('./extraction', () => ({ extractFormSubmissions: vi.fn() }))
vi.mock('./responseMapping', () => ({ mapFormResponsesForCycle: vi.fn() }))
vi.mock('./reviewCompletionRefresh', () => ({ refreshReviewCompletion: vi.fn() }))
vi.mock('./routingRun', () => ({ evaluateCycleSubmissions: vi.fn() }))
vi.mock('./essayExport', () => ({ buildEssayExport: vi.fn() }))
vi.mock('./submittable', () => ({ addSubmissionLabelBulk: vi.fn(), removeSubmissionLabel: vi.fn() }))
vi.mock('../models/Application', () => ({ ApplicationModel: { find: vi.fn() } }))
vi.mock('../models/ReviewStage', () => ({ ReviewStageModel: { find: vi.fn() } }))
vi.mock('../models/Submission', () => ({ SubmissionModel: { find: vi.fn() } }))
vi.mock('../models/Review', () => ({ ReviewModel: { find: vi.fn() } }))
vi.mock('../models/Metadata', () => ({ MetadataModel: { find: vi.fn() } }))
vi.mock('../models/Job', () => ({ JobModel: { updateOne: vi.fn() } }))
vi.mock('../models/RoutingBatch', () => ({ RoutingBatchModel: { find: vi.fn() } }))

async function* iterate<T>(items: T[]) {
  yield* items
}

const options = { cycleId: 'cycle', actor: 'actor', jobId: 'job' }
const ctx = { applicationId: 'app', applicationName: '9th Grade', essayStageId: 'essay', essayStageName: 'Essay Scoring', statusLabels: {} }
const preparation = { ctx, evaluated: 501, labelSync: { labelsAdded: 0, labelsRemoved: 0, failures: [] } }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(runRoutingBatches).mockResolvedValue({ status: 'pending', result: { total: 501, processed: 250 } } as never)
})

describe('Finish Scoring batching', () => {
  it('refreshes once, synchronizes beyond 5000 submissions, and queues all-stage routing', async () => {
    vi.mocked(ReviewStageModel.find).mockReturnValue({ lean: async () => [{ applicationId: 'app', stageId: 'essay', name: 'Essay Scoring', formId: 'review' }] } as never)
    vi.mocked(ApplicationModel.find).mockReturnValue({ lean: async () => [{ _id: 'app', name: '9th Grade', initialFormId: 'initial' }] } as never)
    const submissions = Array.from({ length: 5001 }, (_, index) => ({ submissionId: String(index) }))
    vi.mocked(SubmissionModel.find).mockReturnValue({ sort: () => ({ select: () => ({ lean: () => ({ cursor: () => iterate(submissions) }) }) }) } as never)
    vi.mocked(evaluateCycleSubmissions).mockImplementation(async ({ submissionIds }) => ({ submissions: submissionIds!.map(submissionId => ({ submission: { submissionId } })) }) as never)
    const job = { _id: 'job', payload: {}, result: {} }
    const first = await runEssayFinishScoring(options, job as never)
    expect(first.status).toBe('pending')
    expect(extractFormSubmissions).toHaveBeenCalledTimes(2)
    expect(mapFormResponsesForCycle).toHaveBeenCalledTimes(1)
    expect(refreshReviewCompletion).toHaveBeenCalledTimes(1)
    expect(vi.mocked(evaluateCycleSubmissions).mock.calls.flatMap(([scope]) => scope.submissionIds)).toHaveLength(5001)
    expect(runRoutingBatches).toHaveBeenCalledWith(job, undefined, 'essay')
    expect(job.payload).toEqual({ applicationId: 'app', scope: 'all' })
    expect(JobModel.updateOne).toHaveBeenCalled()
    expect(buildEssayExport).not.toHaveBeenCalled()
    job.result = first.result
    await runEssayFinishScoring(options, job as never)
    expect(extractFormSubmissions).toHaveBeenCalledTimes(2)
    expect(refreshReviewCompletion).toHaveBeenCalledTimes(1)
  })

  it('does not produce final statistics or exports for interrupted batches', async () => {
    vi.mocked(runRoutingBatches).mockResolvedValue({ status: 'failed', result: { requiresReview: true } } as never)
    const result = await runEssayFinishScoring(options, { result: { preparation } } as never)
    expect(result).toMatchObject({ status: 'failed', result: { requiresReview: true, preparation } })
    expect(buildEssayExport).not.toHaveBeenCalled()
    expect(extractFormSubmissions).not.toHaveBeenCalled()
  })

  it('builds the final export from moves in every completed batch', async () => {
    vi.mocked(runRoutingBatches).mockResolvedValue({ status: 'completed', result: { total: 501, processed: 501 } } as never)
    const moves = [{ submissionId: 'first' }, { submissionId: 'last' }]
    const batches = moves.map(move => ({ result: {
      evaluated: 250, moves: 1, noAction: 249, backwardMoves: 0,
      actionsApplied: { labelsAdded: 0, labelsRemoved: 0, assignments: 1, statusLabelsSynced: 0, openedForEditing: 0, closedForEditing: 0 },
      movedSubmissions: [move], failures: []
    } }))
    vi.mocked(RoutingBatchModel.find).mockReturnValue({ sort: () => ({ lean: () => ({ cursor: () => iterate(batches) }) }) } as never)
    vi.mocked(ReviewModel.find).mockReturnValue({ select: () => ({ lean: async () => [] }) } as never)
    vi.mocked(SubmissionModel.find).mockReturnValue({ select: () => ({ lean: async () => [] }) } as never)
    const result = await runEssayFinishScoring(options, { _id: 'job', result: { preparation } } as never)
    expect(result).toMatchObject({ status: 'completed', result: { inEssayStage: 501, routing: { moves: 2, actionsApplied: { assignments: 2 } } } })
    expect(buildEssayExport).toHaveBeenCalledWith(expect.objectContaining({ movedSubmissions: moves, stats: expect.objectContaining({ overall: expect.any(Object) }) }))
    expect(extractFormSubmissions).not.toHaveBeenCalled()
  })
})
