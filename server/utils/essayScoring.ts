import type { AnyBulkWriteOperation } from 'mongoose'
import type { JobProgress } from '../models/Job'
import { ApplicationModel } from '../models/Application'
import { AuditLogModel } from '../models/AuditLog'
import { MetadataModel } from '../models/Metadata'
import { ReviewModel } from '../models/Review'
import { ReviewStageModel } from '../models/ReviewStage'
import { SubmissionModel, type Submission } from '../models/Submission'
import { extractFormSubmissions } from './extraction'
import { mapFormResponsesForCycle } from './responseMapping'
import { refreshReviewCompletion } from './reviewCompletionRefresh'
import { evaluateCycleSubmissions, type SubmissionEvaluation } from './routingRun'
import { normalizeRoutingConfig } from './routingConfig'
import { executeRoutingRun, type RoutingExecutionResult } from './routingExecutor'
import {
  addSubmissionLabelBulk,
  moveSubmissionToStage,
  moveSubmissionsToStage,
  removeSubmissionLabel,
  type SubmittableClientConfig
} from './submittable'
import { buildEssayExport } from './essayExport'
import { buildEssayStats, reviewerKey, type EssayStats } from './essayStats'

type ProgressFn = (update: Partial<JobProgress>) => Promise<void>

export interface EssayContext {
  applicationId: string
  applicationName: string
  projectId: string
  initialFormId?: string
  essayStageId: string
  essayStageName: string
  essayStageOrder: number
  essayFormId?: string
  statusLabels: Record<string, string>
}

export interface EssayJobOptions {
  cycleId: string
  actor: string
  jobId?: string
  setProgress?: ProgressFn
  submittable?: SubmittableClientConfig
}

export interface EssayLabelSyncResult {
  labelsAdded: number
  labelsRemoved: number
  failures: { submissionId: string, error: string }[]
}

export async function resolveEssayContext(cycleId: string): Promise<EssayContext> {
  const essayStages = await ReviewStageModel.find({ cycleId, name: /essay/i }).lean()
  if (!essayStages.length) throw new Error('No essay review stage is configured for this cycle')
  const applicationIds = [...new Set(essayStages.map(stage => String(stage.applicationId)))]
  const applications = await ApplicationModel.find({ _id: { $in: applicationIds } }).lean()
  const application = applications.find(app => /9th|ninth/i.test(app.name)) || applications[0]
  if (!application) throw new Error('The essay stage is not attached to a known application in this cycle')
  const stage = essayStages
    .filter(candidate => String(candidate.applicationId) === String(application._id))
    .sort((a, b) => (a.order || 0) - (b.order || 0))[0]!
  const routing = normalizeRoutingConfig(stage.routing)
  return {
    applicationId: String(application._id),
    applicationName: application.name,
    projectId: application.projectId,
    initialFormId: application.initialFormId,
    essayStageId: stage.stageId,
    essayStageName: stage.name,
    essayStageOrder: stage.order || 0,
    essayFormId: stage.formId,
    statusLabels: (routing.statusLabels || {}) as Record<string, string>
  }
}

async function refreshEssayData(ctx: EssayContext, cycleId: string, setProgress: ProgressFn, submittable?: SubmittableClientConfig) {
  if (ctx.initialFormId) {
    await setProgress({ phase: 'extracting', message: 'Re-extracting submissions from Submittable' })
    await extractFormSubmissions(cycleId, ctx.initialFormId, setProgress, submittable)
  }
  if (ctx.essayFormId && ctx.essayFormId !== ctx.initialFormId) {
    await setProgress({ phase: 'extracting', message: 'Re-extracting essay reviews from Submittable' })
    await extractFormSubmissions(cycleId, ctx.essayFormId, setProgress, submittable)
  }
  await setProgress({ phase: 'mapping', message: 'Mapping form responses' })
  await mapFormResponsesForCycle(cycleId, [ctx.applicationId], setProgress)
  await refreshReviewCompletion({ cycleId, applicationId: ctx.applicationId, setProgress })
}

function essayLedgerEntry(item: SubmissionEvaluation, ctx: EssayContext) {
  return item.completion.reviewCompletion.find(entry => entry.stageId === ctx.essayStageId)
}

export async function syncEssayStatusLabels(
  ctx: EssayContext,
  evaluated: SubmissionEvaluation[],
  setProgress: ProgressFn,
  submittable?: SubmittableClientConfig
): Promise<EssayLabelSyncResult> {
  const result: EssayLabelSyncResult = { labelsAdded: 0, labelsRemoved: 0, failures: [] }
  const mappedLabelIds = Object.values(ctx.statusLabels).filter(Boolean)
  if (!mappedLabelIds.length) return result

  const addsByLabel = new Map<string, string[]>()
  const removals: { submissionId: string, labelId: string }[] = []
  const finalLabels = new Map<string, string[]>()

  for (const item of evaluated) {
    const submissionId = item.submission.submissionId
    const current = new Set(item.submission.labelIds || [])
    const entry = essayLedgerEntry(item, ctx)
    const desired = entry ? ctx.statusLabels[entry.status] : undefined
    const next = new Set(current)
    for (const labelId of mappedLabelIds) {
      if (labelId === desired) {
        if (!current.has(labelId)) {
          const list = addsByLabel.get(labelId) || []
          list.push(submissionId)
          addsByLabel.set(labelId, list)
        }
        next.add(labelId)
      } else if (current.has(labelId)) {
        removals.push({ submissionId, labelId })
        next.delete(labelId)
      }
    }
    if (next.size !== current.size || [...next].some(id => !current.has(id))) {
      finalLabels.set(submissionId, [...next])
    }
  }

  await setProgress({ phase: 'syncing_labels', message: 'Synchronizing essay status labels' })
  for (const [labelId, submissionIds] of addsByLabel) {
    try {
      await addSubmissionLabelBulk(submissionIds, labelId, submittable)
      result.labelsAdded += submissionIds.length
    } catch (error) {
      for (const submissionId of submissionIds) {
        result.failures.push({ submissionId, error: error instanceof Error ? error.message : String(error) })
        finalLabels.delete(submissionId)
      }
    }
  }
  for (const removal of removals) {
    try {
      await removeSubmissionLabel(removal.submissionId, removal.labelId, submittable)
      result.labelsRemoved += 1
    } catch (error) {
      result.failures.push({ submissionId: removal.submissionId, error: error instanceof Error ? error.message : String(error) })
      finalLabels.delete(removal.submissionId)
    }
  }

  if (finalLabels.size) {
    const operations: AnyBulkWriteOperation<Submission>[] = [...finalLabels].map(([submissionId, labelIds]) => ({
      updateOne: { filter: { submissionId }, update: { $set: { labelIds } } }
    }))
    await SubmissionModel.bulkWrite(operations)
  }
  return result
}

async function loadReviewerNames(reviewerKeys: string[]): Promise<Map<string, string>> {
  if (!reviewerKeys.length) return new Map()
  const team = await MetadataModel.find({
    type: 'team',
    $or: [{ externalId: { $in: reviewerKeys } }, { 'data.email': { $in: reviewerKeys } }]
  }).select('externalId name data').lean()
  const byKey = new Map<string, string>()
  for (const member of team) {
    const data = (member.data || {}) as { email?: string, name?: { full?: string } }
    const name = data.name?.full?.trim() || member.name
    if (!name) continue
    byKey.set(member.externalId, name)
    if (data.email) byKey.set(data.email, name)
  }
  return byKey
}

async function computeEssayStats(ctx: EssayContext, cycleId: string, includeOverall: boolean): Promise<EssayStats> {
  const [reviews, submissions] = await Promise.all([
    ReviewModel.find({ cycleId, applicationId: ctx.applicationId, stageId: ctx.essayStageId })
      .select('reviewerId createdBy score status completedAt createdAt')
      .lean(),
    SubmissionModel.find({ cycleId, applicationId: ctx.applicationId })
      .select('reviewCompletion')
      .lean()
  ])
  const reviewerIds = [...new Set(reviews.map(review => reviewerKey(review)).filter(id => id !== 'unknown'))]
  const reviewerNames = await loadReviewerNames(reviewerIds)
  const counts = new Map<string, number>()
  for (const submission of submissions) {
    const entry = (submission.reviewCompletion || []).find(item => item.stageId === ctx.essayStageId)
    if (entry?.status) counts.set(entry.status, (counts.get(entry.status) || 0) + 1)
  }
  const statusCounts = [...counts.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count)
  return buildEssayStats(reviews, { reviewerNames, includeOverall, statusCounts })
}

export async function runEssayBeginScoring(options: EssayJobOptions) {
  const setProgress = options.setProgress || (async () => {})
  const ctx = await resolveEssayContext(options.cycleId)
  await refreshEssayData(ctx, options.cycleId, setProgress, options.submittable)

  const evaluation = await evaluateCycleSubmissions({
    cycleId: options.cycleId,
    applicationId: ctx.applicationId,
    limit: 5000,
    maxLimit: 5000
  })

  const movers = evaluation.submissions.filter((item) => {
    const entry = essayLedgerEntry(item, ctx)
    return entry?.required && !entry.complete && item.submission.currentStageId !== ctx.essayStageId
  })
  const alreadyInStage = evaluation.submissions.filter((item) => {
    const entry = essayLedgerEntry(item, ctx)
    return entry?.required && !entry.complete && item.submission.currentStageId === ctx.essayStageId
  }).length
  const complete = evaluation.submissions.filter(item => essayLedgerEntry(item, ctx)?.complete).length

  await setProgress({
    phase: 'moving',
    processed: 0,
    total: movers.length,
    percent: movers.length ? 0 : 100,
    message: `Moving ${movers.length} submissions to ${ctx.essayStageName}`
  })

  const movedIds = new Set<string>()
  const failures: { submissionId: string, error: string }[] = []
  try {
    await moveSubmissionsToStage(ctx.essayStageId, movers.map(item => item.submission.submissionId), options.submittable)
    movers.forEach(item => movedIds.add(item.submission.submissionId))
  } catch {
    for (const item of movers) {
      try {
        await moveSubmissionToStage(item.submission.submissionId, ctx.essayStageId, options.submittable)
        movedIds.add(item.submission.submissionId)
      } catch (error) {
        failures.push({ submissionId: item.submission.submissionId, error: error instanceof Error ? error.message : String(error) })
      }
    }
  }
  await setProgress({ phase: 'moving', processed: movers.length, total: movers.length, percent: 100, message: `Moved ${movedIds.size} / ${movers.length} submissions` })

  if (movedIds.size) {
    const now = new Date()
    const moved = movers.filter(item => movedIds.has(item.submission.submissionId))
    await SubmissionModel.bulkWrite(moved.map(item => ({
      updateOne: {
        filter: { submissionId: item.submission.submissionId },
        update: {
          $set: { currentStageId: ctx.essayStageId, currentStageName: ctx.essayStageName },
          $push: {
            routingHistory: {
              fromStageId: item.submission.currentStageId,
              fromStageName: item.submission.currentStageName,
              toStageId: ctx.essayStageId,
              toStageName: ctx.essayStageName,
              reason: 'essay_begin_scoring',
              backward: ctx.essayStageOrder < (item.stages.find(stage => stage.stageId === item.submission.currentStageId)?.order ?? ctx.essayStageOrder),
              jobId: options.jobId,
              at: now
            }
          }
        }
      }
    })))
    await AuditLogModel.insertMany(moved.map(item => ({
      action: 'essay_begin_move',
      actor: options.actor,
      cycleId: options.cycleId,
      applicationId: ctx.applicationId,
      entityType: 'submission',
      entityId: item.submission.submissionId,
      changes: [{ path: 'currentStageId', before: item.submission.currentStageId, after: ctx.essayStageId }]
    })))
  }

  const labelSync = await syncEssayStatusLabels(ctx, evaluation.submissions, setProgress, options.submittable)
  const stats = await computeEssayStats(ctx, options.cycleId, false)
  await setProgress({ phase: 'completed', percent: 100, message: `Begin scoring complete: ${movedIds.size} moved` })

  return {
    applicationId: ctx.applicationId,
    applicationName: ctx.applicationName,
    essayStageId: ctx.essayStageId,
    essayStageName: ctx.essayStageName,
    evaluated: evaluation.submissions.length,
    moved: movedIds.size,
    alreadyInStage,
    complete,
    failures: [...failures, ...labelSync.failures],
    labelSync: { added: labelSync.labelsAdded, removed: labelSync.labelsRemoved },
    stats
  }
}

export async function runEssayUpdateScoring(options: EssayJobOptions) {
  const setProgress = options.setProgress || (async () => {})
  const ctx = await resolveEssayContext(options.cycleId)
  await refreshEssayData(ctx, options.cycleId, setProgress, options.submittable)

  const evaluation = await evaluateCycleSubmissions({
    cycleId: options.cycleId,
    applicationId: ctx.applicationId,
    limit: 5000,
    maxLimit: 5000
  })
  const labelSync = await syncEssayStatusLabels(ctx, evaluation.submissions, setProgress, options.submittable)

  await setProgress({ phase: 'stats', message: 'Computing scoring statistics' })
  const stats = await computeEssayStats(ctx, options.cycleId, false)
  const exportFile = buildEssayExport({ title: 'Essay Scoring Update', stats, applicationName: ctx.applicationName })
  await setProgress({ phase: 'completed', percent: 100, message: 'Update scoring complete' })

  return {
    applicationId: ctx.applicationId,
    applicationName: ctx.applicationName,
    essayStageId: ctx.essayStageId,
    essayStageName: ctx.essayStageName,
    evaluated: evaluation.submissions.length,
    failures: labelSync.failures,
    labelSync: { added: labelSync.labelsAdded, removed: labelSync.labelsRemoved },
    stats,
    export: exportFile
  }
}

export async function runEssayFinishScoring(options: EssayJobOptions) {
  const setProgress = options.setProgress || (async () => {})
  const ctx = await resolveEssayContext(options.cycleId)
  await refreshEssayData(ctx, options.cycleId, setProgress, options.submittable)

  const evaluation = await evaluateCycleSubmissions({
    cycleId: options.cycleId,
    applicationId: ctx.applicationId,
    limit: 5000,
    maxLimit: 5000
  })
  const labelSync = await syncEssayStatusLabels(ctx, evaluation.submissions, setProgress, options.submittable)

  const inEssayIds = evaluation.submissions
    .filter(item => item.submission.currentStageId === ctx.essayStageId)
    .map(item => item.submission.submissionId)

  let routing: RoutingExecutionResult | undefined
  if (inEssayIds.length) {
    routing = await executeRoutingRun({
      cycleId: options.cycleId,
      submissionIds: inEssayIds,
      actor: options.actor,
      jobId: options.jobId,
      setProgress,
      submittable: options.submittable
    })
  } else {
    await setProgress({ phase: 'executing', percent: 100, message: 'No submissions currently in the essay stage' })
  }

  await setProgress({ phase: 'stats', message: 'Computing scoring statistics' })
  const stats = await computeEssayStats(ctx, options.cycleId, true)
  const exportFile = buildEssayExport({
    title: 'Essay Scoring Finish',
    stats,
    applicationName: ctx.applicationName,
    movedSubmissions: routing?.movedSubmissions
  })
  await setProgress({ phase: 'completed', percent: 100, message: 'Finish scoring complete' })

  return {
    applicationId: ctx.applicationId,
    applicationName: ctx.applicationName,
    essayStageId: ctx.essayStageId,
    essayStageName: ctx.essayStageName,
    evaluated: evaluation.submissions.length,
    inEssayStage: inEssayIds.length,
    routing: routing
      ? {
          evaluated: routing.evaluated,
          moves: routing.moves,
          noAction: routing.noAction,
          backwardMoves: routing.backwardMoves,
          actionsApplied: routing.actionsApplied,
          failures: routing.failures
        }
      : undefined,
    failures: [...labelSync.failures, ...(routing?.failures || [])],
    labelSync: { added: labelSync.labelsAdded, removed: labelSync.labelsRemoved },
    stats,
    export: exportFile
  }
}
