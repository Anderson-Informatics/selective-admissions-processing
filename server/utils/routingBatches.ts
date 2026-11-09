import type { HydratedDocument } from 'mongoose'
import { JobModel, type Job, type JobProgress } from '../models/Job'
import { RoutingBatchModel } from '../models/RoutingBatch'
import { SubmissionModel } from '../models/Submission'
import { routingPreviewFilter } from './routingPreview'
import { executeRoutingRun } from './routingExecutor'
import type { SubmittableClientConfig } from './submittable'

export async function runRoutingBatches(job: HydratedDocument<Job>, submittable?: SubmittableClientConfig, stageId?: string) {
  const jobId = String(job._id)
  if (!job.payload.routingInitialized) {
    if (await RoutingBatchModel.exists({ jobId })) {
      return { status: 'failed' as const, result: { requiresReview: true, message: 'Routing selection was interrupted before execution. No batches were executed; start a new run.' } }
    }
    const filter = routingPreviewFilter(job.cycleId, job.payload.applicationId, job.payload.labelId)
    if (stageId) filter.currentStageId = stageId
    const cursor = SubmissionModel.find(filter).sort({ _id: 1 }).select('submissionId').lean().cursor()
    let ids: string[] = []
    let index = 0
    let selected = 0
    const limit = job.payload.scope === 'all' ? Infinity : job.payload.limit || 250
    const save = async () => {
      await RoutingBatchModel.updateOne({ jobId, index }, { $setOnInsert: { submissionIds: ids, status: 'pending' } }, { upsert: true })
      index += 1
      ids = []
    }
    for await (const submission of cursor) {
      if (selected >= limit) break
      ids.push(submission.submissionId)
      selected += 1
      if (ids.length === 250) await save()
    }
    if (ids.length) await save()
    await JobModel.updateOne({ _id: job._id }, { $set: { 'payload.routingInitialized': true, 'progress.total': selected, 'progress.phase': 'routing', 'progress.message': `${selected} submissions selected for routing` } })
  }

  const uncertain = await RoutingBatchModel.findOne({ jobId, status: 'running' }).lean()
  if (uncertain) {
    return { status: 'failed' as const, result: { requiresReview: true, submissionIds: uncertain.submissionIds, message: 'A routing batch was interrupted. Review these submissions and external actions before starting another run; it was not replayed.' } }
  }
  const batch = await RoutingBatchModel.findOneAndUpdate({ jobId, status: 'pending' }, { $set: { status: 'running' } }, { sort: { index: 1 }, returnDocument: 'after' })
  if (batch) {
    const result = await executeRoutingRun({
      cycleId: job.cycleId,
      applicationId: job.payload.applicationId,
      submissionIds: batch.submissionIds,
      limit: batch.submissionIds.length,
      excludeSubmissionIds: job.payload.excludeSubmissionIds,
      dryRun: job.payload.dryRun,
      actor: job.createdBy,
      jobId,
      submittable
    })
    await RoutingBatchModel.updateOne({ _id: batch._id }, { $set: { status: 'completed', result } })
  }
  const batches = RoutingBatchModel.find({ jobId }).select('submissionIds status result').lean().cursor()
  const summary = { total: 0, processed: 0, evaluated: 0, moves: 0, noAction: 0, failures: 0, failureExamples: [] as Array<{ submissionId: string, step: string, error: string }>, dryRun: job.payload.dryRun === true }
  for await (const item of batches) {
    summary.total += item.submissionIds.length
    if (item.status !== 'completed') continue
    summary.processed += item.submissionIds.length
    summary.evaluated += item.result?.evaluated || 0
    summary.moves += summary.dryRun ? item.result?.moves || 0 : item.result?.movedSubmissions?.length || 0
    summary.noAction += item.result?.noAction || 0
    summary.failures += item.result?.failures.length || 0
    summary.failureExamples.push(...(item.result?.failures || []).slice(0, 20 - summary.failureExamples.length))
  }
  const done = summary.processed === summary.total
  const progress: JobProgress = {
    phase: done ? 'completed' : 'routing',
    total: summary.total,
    processed: summary.processed,
    percent: summary.total ? Math.round(summary.processed / summary.total * 100) : 100,
    message: `${summary.processed} / ${summary.total} processed, ${summary.moves} ${summary.dryRun ? 'proposed moves' : 'moves'}, ${summary.noAction} unchanged, ${summary.failures} failures`
  }
  await JobModel.updateOne({ _id: job._id }, { $set: { progress, ...(!done ? { attempts: 0 } : {}) } })
  return { status: done ? 'completed' as const : 'pending' as const, result: summary }
}
