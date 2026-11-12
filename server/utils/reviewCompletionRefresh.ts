/* eslint-disable @typescript-eslint/no-explicit-any */
import type { AnyBulkWriteOperation } from 'mongoose'
import { ApplicationModel } from '../models/Application'
import { GpaRecordModel, type GpaRecord } from '../models/GpaRecord'
import { resolveSubmissionRound } from './cycleRounds'
import { selectDpscdSnapshot } from './dpscdSnapshots'
import { ReviewModel } from '../models/Review'
import { ReviewStageModel } from '../models/ReviewStage'
import { SubmissionModel } from '../models/Submission'
import { normalizeRoutingConfig } from './routingConfig'
import { computeReviewCompletion, resolveGpa, type RoutingContext, type RoutingReview, type RoutingStage } from './routingEvaluator'
import { computeGpaScore, deriveGpaMultiplier, resolveGpaBonusLabelId } from './gpaScoring'
import { normalizeScoringConfig } from './scoreCompilation'
import { clearGpaRecordsForSubmissions } from './withdrawnGpa'
import { isWithdrawnSubmission } from './submissionStatus'

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
  clearedWithdrawn: number
  wouldClearWithdrawn?: number
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

function toRoutingReviews(reviews: Array<Record<string, any>>, stages: RoutingStage[]): RoutingReview[] {
  return reviews.map(review => ({
    stageId: review.stageId,
    stageName: stages.find(stage => stage.stageId === review.stageId)?.name || review.stageName,
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
    reviews: toRoutingReviews(reviews, routingStages),
    gpa,
    cycleRound
  }
  const preliminary = computeReviewCompletion(routingStages, { ...context, prerequisitesComplete: true })
  const prerequisitesComplete = preliminary.reviewCompletion
    .filter(entry => (entry.role === 'work' || entry.role === 'initial') && !/ready for placement/i.test(entry.name))
    .every(entry => !entry.required || entry.complete)
  const completion = computeReviewCompletion(routingStages, { ...context, prerequisitesComplete })
  const resolvedGpa = resolveGpa(context)
  return {
    ...completion,
    gpaStatus: resolvedGpa.status,
    resolvedGpa,
    gpaDpscd: Boolean(gpa?.dpscd),
    gpaOptIn: Boolean(gpa?.optIn)
  }
}

function latestCompletedReview(reviews: Array<Record<string, any>>): Record<string, any> | undefined {
  const completed = reviews.filter(review => Boolean(review.completedAt) || /^(complete|completed)$/i.test(review.status?.trim?.() || ''))
  const stamp = (review: Record<string, any>, key: 'completedAt' | 'createdAt') => review[key] ? new Date(review[key]).getTime() : 0
  return completed.sort((a, b) => stamp(b, 'completedAt') - stamp(a, 'completedAt') || stamp(b, 'createdAt') - stamp(a, 'createdAt'))[0]
}

export async function refreshReviewCompletion(options: RefreshOptions): Promise<RefreshResult> {
  const batchSize = Math.max(1, Math.min(options.batchSize || 250, 1000))
  const submissionFilter: Record<string, unknown> = { cycleId: options.cycleId }
  if (options.applicationId) submissionFilter.applicationId = options.applicationId

  const total = await SubmissionModel.countDocuments(submissionFilter)
  const applicationIds = await SubmissionModel.distinct('applicationId', submissionFilter)
  const applicationDocs = await ApplicationModel.find({ _id: { $in: applicationIds } }).select('rounds scoring').lean()
  const roundsByApplication = new Map(applicationDocs.map(application => [String(application._id), application.rounds || []]))
  const scoringByApplication = new Map(applicationDocs.map(application => [String(application._id), normalizeScoringConfig(application.scoring)]))
  const gpaBonusLabelId = await resolveGpaBonusLabelId()
  const stageDocs = await ReviewStageModel.find({ cycleId: options.cycleId, applicationId: { $in: applicationIds } }).lean()
  const stagesByApplication = new Map<string, Array<Record<string, any>>>()
  for (const stage of stageDocs) {
    const key = String(stage.applicationId)
    const list = stagesByApplication.get(key) || []
    list.push(stage as Record<string, any>)
    stagesByApplication.set(key, list)
  }

  const result: RefreshResult = { processed: 0, updated: 0, diagnostics: 0, applications: applicationIds.length, clearedWithdrawn: 0, dryRun: options.dryRun === true }
  await options.setProgress?.({ phase: 'refreshing', processed: 0, total, percent: total ? 0 : 100, message: `Refreshing ${total} submissions` })

  let lastId: unknown
  while (result.processed < total) {
    const batchFilter = lastId ? { ...submissionFilter, _id: { $gt: lastId } } : submissionFilter
    const submissions = await SubmissionModel.find(batchFilter).sort({ _id: 1 }).limit(batchSize).lean()
    if (!submissions.length) break
    lastId = submissions[submissions.length - 1]?._id
    const submissionIds = submissions.map(submission => submission.submissionId)
    const withdrawnSubmissionIds = submissions.filter(isWithdrawnSubmission).map(submission => submission.submissionId)
    if (!options.dryRun) {
      result.clearedWithdrawn += await clearGpaRecordsForSubmissions(options.cycleId, withdrawnSubmissionIds)
    }
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
    const withdrawnIds = new Set(withdrawnSubmissionIds)
    if (options.dryRun) {
      result.wouldClearWithdrawn = (result.wouldClearWithdrawn || 0) + gpaRecords.filter(record => withdrawnIds.has(record.submissionId)).length
    }
    const gpaBySubmission = new Map(gpaRecords.map(record => [record.submissionId, record]))
    const operations = []
    const gpaOperations: AnyBulkWriteOperation<GpaRecord>[] = []

    for (const submission of submissions) {
      const stages = stagesByApplication.get(String(submission.applicationId)) || []
      const round = resolveSubmissionRound(submission, roundsByApplication.get(String(submission.applicationId)) || [])
      const submissionReviews = reviewsBySubmission.get(submission.submissionId) || []
      const withdrawn = withdrawnIds.has(submission.submissionId)
      const storedGpa = withdrawn ? undefined : gpaBySubmission.get(submission.submissionId)
      const gpaRecord = storedGpa ? { ...storedGpa, dpscd: selectDpscdSnapshot(storedGpa.dpscd, submission, roundsByApplication.get(String(submission.applicationId)) || []) } : undefined
      const completion = buildReviewCompletionForSubmission(
        submission as Record<string, any>,
        stages,
        submissionReviews,
        gpaRecord as Record<string, any> | undefined,
        round.key
      )
      result.processed += 1
      result.diagnostics += completion.diagnostics.length
      if (!options.dryRun) {
        if (!withdrawn) {
          const scoring = scoringByApplication.get(String(submission.applicationId)) || normalizeScoringConfig(undefined)
          const partialReview = latestCompletedReview(
            submissionReviews.filter(review => /partial\s*gpa|gpa\s*partial/i.test(review.stageName || '') || Object.hasOwn(review.mappedData || {}, 'PartialGPA'))
          )
          const gpaMultiplier = deriveGpaMultiplier({
            resolvedSource: completion.resolvedGpa.source,
            hasResolvedGpa: completion.resolvedGpa.cumulativeGpa != null,
            semesters: partialReview?.mappedData?.Semesters,
            quartersAvailable: gpaRecord?.dpscd?.quartersAvailable
          }, scoring.multiplierMap)
          const gpaBonusEligible = Boolean(gpaBonusLabelId) && (submission.labelIds || []).includes(gpaBonusLabelId!)
          const gpaBonus = gpaBonusEligible ? scoring.gpaBonusPoints : 0
          const gpaScore = completion.resolvedGpa.cumulativeGpa == null ? null : computeGpaScore(completion.resolvedGpa.cumulativeGpa, gpaMultiplier, gpaBonus, scoring.gpaTable)
          gpaOperations.push({
            updateOne: {
              filter: { cycleId: options.cycleId, submissionId: submission.submissionId },
              update: {
                $setOnInsert: { cycleId: options.cycleId, submissionId: submission.submissionId },
                $set: {
                  ...(gpaRecord?.dpscd?.snapshots
                    ? {
                        'dpscd.cumulativeGpa': gpaRecord.dpscd.cumulativeGpa ?? null,
                        'dpscd.quartersAvailable': gpaRecord.dpscd.quartersAvailable ?? null,
                        'dpscd.gpaStatus': gpaRecord.dpscd.gpaStatus ?? null,
                        'dpscd.selectedSnapshot': gpaRecord.dpscd.selectedSnapshot ?? null,
                        'dpscd.selectedRound': gpaRecord.dpscd.selectedRound ?? null,
                        'dpscd.selectionIssue': gpaRecord.dpscd.selectionIssue ?? null
                      }
                    : {}),
                  resolvedCumulativeGpa: completion.resolvedGpa.cumulativeGpa,
                  resolvedSource: completion.resolvedGpa.source,
                  gpaMultiplier,
                  gpaBonusEligible,
                  gpaBonus,
                  gpaScore
                }
              },
              upsert: true
            }
          })
        }
        operations.push({
          updateOne: {
            filter: { cycleId: options.cycleId, submissionId: submission.submissionId },
            update: {
              $set: {
                reviewCompletion: completion.reviewCompletion,
                gpaStatus: completion.gpaStatus,
                gpaDpscd: completion.gpaDpscd,
                gpaOptIn: completion.gpaOptIn,
                roundKey: round.key,
                roundName: round.name,
                roundStatus: round.status
              }
            }
          }
        })
      }
    }

    if (gpaOperations.length) await GpaRecordModel.bulkWrite(gpaOperations)
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
