/* eslint-disable @typescript-eslint/no-explicit-any */
import { CycleModel } from '../models/Cycle'
import { GpaRecordModel } from '../models/GpaRecord'
import { resolveCycleRound } from './cycleRounds'
import { ReviewModel } from '../models/Review'
import { ReviewStageModel } from '../models/ReviewStage'
import { SubmissionModel } from '../models/Submission'
import { normalizeRoutingConfig } from './routingConfig'
import { computeReviewCompletion, type RoutingContext, type RoutingReview, type RoutingStage } from './routingEvaluator'

export interface RefreshProgress {
  (update: { phase?: string, processed?: number, total?: number, percent?: number, message?: string }): Promise<void>
}

export interface RefreshOptions {
  cycleId: string
  applicationId?: string
  batchSize?: number
  dryRun?: boolean
  setProgress?: RefreshProgress
}

export interface RefreshResult {
  processed: number
  updated: number
  diagnostics: number
  applications: number
  dryRun: boolean
}

function toRoutingStages(stages: Array<Record<string, any>>): RoutingStage[] {
  return stages.map(stage => ({
    stageId: stage.stageId,
    name: stage.name,
    order: stage.order || 0,
    role: stage.role || 'work',
    routing: normalizeRoutingConfig(stage.routing)
  }))
}

function toRoutingReviews(reviews: Array<Record<string, any>>): RoutingReview[] {
  return reviews.map(review => ({
    stageId: review.stageId,
    status: review.status,
    score: review.score,
    completedAt: review.completedAt,
    createdAt: review.createdAt,
    mappedData: review.mappedData || {}
  }))
}

export function buildReviewCompletionForSubmission(
  submission: Record<string, any>,
  stages: Array<Record<string, any>>,
  reviews: Array<Record<string, any>> = [],
  gpa?: Record<string, any>,
  cycleRound?: string
) {
  const routingStages = toRoutingStages(stages)
  const context: RoutingContext = {
    submission: {
      submissionId: submission.submissionId,
      mappedFields: submission.mappedFields || {},
      isMapped: submission.isMapped === true,
      labelIds: submission.labelIds || [],
      currentStageId: submission.currentStageId,
      hsptResultId: submission.hsptResultId,
      status: submission.status
    },
    reviews: toRoutingReviews(reviews),
    gpa,
    cycleRound
  }
  const preliminary = computeReviewCompletion(routingStages, { ...context, prerequisitesComplete: true })
  const prerequisitesComplete = preliminary.reviewCompletion
    .filter(entry => (entry.role === 'work' || entry.role === 'initial') && !/ready for placement/i.test(entry.name))
    .every(entry => !entry.required || entry.complete)
  return computeReviewCompletion(routingStages, { ...context, prerequisitesComplete })
}

export async function refreshReviewCompletion(options: RefreshOptions): Promise<RefreshResult> {
  const batchSize = Math.max(1, Math.min(options.batchSize || 250, 1000))
  const submissionFilter: Record<string, unknown> = { cycleId: options.cycleId }
  if (options.applicationId) submissionFilter.applicationId = options.applicationId

  const cycle = await CycleModel.findById(options.cycleId).lean()
  const rounds = cycle?.rounds || []
  const total = await SubmissionModel.countDocuments(submissionFilter)
  const applicationIds = await SubmissionModel.distinct('applicationId', submissionFilter)
  const stageDocs = await ReviewStageModel.find({ cycleId: options.cycleId, applicationId: { $in: applicationIds } }).lean()
  const stagesByApplication = new Map<string, Array<Record<string, any>>>()
  for (const stage of stageDocs) {
    const key = String(stage.applicationId)
    const list = stagesByApplication.get(key) || []
    list.push(stage as Record<string, any>)
    stagesByApplication.set(key, list)
  }

  const result: RefreshResult = { processed: 0, updated: 0, diagnostics: 0, applications: applicationIds.length, dryRun: options.dryRun === true }
  await options.setProgress?.({ phase: 'refreshing', processed: 0, total, percent: total ? 0 : 100, message: `Refreshing ${total} submissions` })

  let lastId: unknown
  while (result.processed < total) {
    const batchFilter = lastId ? { ...submissionFilter, _id: { $gt: lastId } } : submissionFilter
    const submissions = await SubmissionModel.find(batchFilter).sort({ _id: 1 }).limit(batchSize).lean()
    if (!submissions.length) break
    lastId = submissions[submissions.length - 1]?._id
    const submissionIds = submissions.map(submission => submission.submissionId)
    const [reviews, gpaRecords] = await Promise.all([
      ReviewModel.find({ cycleId: options.cycleId, submissionId: { $in: submissionIds } }).lean(),
      GpaRecordModel.find({ cycleId: options.cycleId, submissionId: { $in: submissionIds } }).lean()
    ])
    const reviewsBySubmission = new Map<string, Array<Record<string, any>>>()
    for (const review of reviews) {
      const list = reviewsBySubmission.get(review.submissionId) || []
      list.push(review as Record<string, any>)
      reviewsBySubmission.set(review.submissionId, list)
    }
    const gpaBySubmission = new Map(gpaRecords.map(record => [record.submissionId, record]))
    const operations = []

    for (const submission of submissions) {
      const stages = stagesByApplication.get(String(submission.applicationId)) || []
      const mappedFields = submission.mappedFields || {}
      const submissionDate = mappedFields.submissionDate || mappedFields.SubmissionDate || submission.submissionDate
      const round = resolveCycleRound(submissionDate, rounds)
      const completion = buildReviewCompletionForSubmission(
        submission as Record<string, any>,
        stages,
        reviewsBySubmission.get(submission.submissionId) || [],
        gpaBySubmission.get(submission.submissionId) as Record<string, any> | undefined,
        round.key
      )
      result.processed += 1
      result.diagnostics += completion.diagnostics.length
      if (!options.dryRun) {
        operations.push({
          updateOne: {
            filter: { cycleId: options.cycleId, submissionId: submission.submissionId },
            update: {
              $set: {
                reviewCompletion: completion.reviewCompletion,
                ...(submissionDate ? { submissionDate: new Date(String(submissionDate)) } : {}),
                roundKey: round.key,
                roundName: round.name,
                roundStatus: round.status
              }
            }
          }
        })
      }
    }

    if (operations.length) {
      const writeResult = await SubmissionModel.bulkWrite(operations)
      result.updated += writeResult.modifiedCount
    }
    await options.setProgress?.({
      phase: 'refreshing',
      processed: result.processed,
      total,
      message: `${options.dryRun ? 'Evaluated' : 'Updated'} ${result.processed} / ${total} submissions`
    })
  }

  await options.setProgress?.({ phase: 'completed', processed: result.processed, total, percent: 100, message: `Review completion refresh complete: ${result.processed} processed` })
  return result
}
