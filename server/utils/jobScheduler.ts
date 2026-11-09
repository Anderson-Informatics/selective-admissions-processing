import { JobScheduleModel, ScheduleCycleModel, ScheduleRunModel } from '../models/JobSchedule'
import { CycleModel } from '../models/Cycle'
import { ESSAY_JOB_TYPES, JobModel, type Job } from '../models/Job'
import { detroitParts, occurrenceOn } from './scheduleTime'
import { hasConflictingJob, jobLock } from './jobLocks'
import { updateParentJob } from './jobWorker'

export function hasPartialResult(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false
  const value = result as Record<string, unknown>
  if (Array.isArray(value.failures) ? value.failures.length > 0 : typeof value.failures === 'number' && value.failures > 0) return true
  return ['routing', 'labelSync'].some(key => hasPartialResult(value[key]))
}
const terminal = (job: Job) => ['completed', 'failed'].includes(job.status) && job.workerSettled !== false

async function reconcileCycle(cycleId: string, now: Date) {
  await ScheduleCycleModel.updateOne({ cycleId }, { $setOnInsert: { cycleId } }, { upsert: true })
  let cycle = await ScheduleCycleModel.findOne({ cycleId }).lean()
  if (!cycle || cycle.hold) return
  if (!cycle.runId) {
    const first = await ScheduleRunModel.findOne({ cycleId, status: { $in: ['queued', 'running'] } }).sort({ dueAt: 1, scheduleId: 1, _id: 1 }).lean()
    if (!first) return
    cycle = await ScheduleCycleModel.findOneAndUpdate({ cycleId, runId: { $exists: false }, hold: { $exists: false } }, { $set: { runId: String(first._id) } }, { returnDocument: 'after' }).lean()
    if (!cycle) return
  }
  const run = await ScheduleRunModel.findById(cycle.runId).lean()
  if (!run || !['queued', 'running'].includes(run.status)) {
    await ScheduleCycleModel.updateOne({ cycleId, runId: cycle.runId }, { $unset: { runId: 1 } })
    return
  }
  const runId = String(run._id)
  await ScheduleRunModel.updateOne({ _id: runId, status: 'queued' }, { $set: { status: 'running', startedAt: now } })
  const type = run.steps[run.stepIndex]
  if (!type) return
  const executionKey = `${runId}:${run.stepIndex}`
  let root = await JobModel.findOne({ executionKey }).lean()
  if (!root) {
    const lock = jobLock(type, cycleId)
    if (await hasConflictingJob(type, cycleId)) {
      await ScheduleRunModel.updateOne({ _id: runId, stepIndex: run.stepIndex }, { $set: { message: 'Waiting for an overlapping manual routing or essay job' } })
      return
    }
    try {
      await JobModel.updateOne({ executionKey }, { $setOnInsert: {
        ...lock, type, cycleId, createdBy: run.actor, status: 'pending', scheduleRunId: runId,
        scheduleStep: run.stepIndex, payload: type === 'run_routing' ? { scope: 'all', dryRun: run.dryRun } : {},
        progress: { phase: 'queued', message: 'Queued by scheduler' }
      } }, { upsert: true })
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error
    }
    root = await JobModel.findOne({ executionKey }).lean()
    if (!root) return
  }
  if (root.type === 'submission_extraction') {
    const children = await JobModel.find({ parentJobId: root._id }).lean()
    if (children.length && children.every(terminal)) await updateParentJob(String(root._id))
  }
  if (terminal(root)) await JobModel.updateMany({ dependencyOf: String(root._id), status: 'waiting' }, { $set: { status: 'pending' } })
  const jobs = await JobModel.find({ scheduleRunId: runId, scheduleStep: run.stepIndex }).lean()
  if (!jobs.length || jobs.some(job => !terminal(job))) return
  const failed = jobs.find(job => job.status === 'failed')
  const uncertain = jobs.some(job => job.result?.requiresReview || (job.status === 'failed' && (job.type === 'run_routing' || ESSAY_JOB_TYPES.includes(job.type))))
  const partial = run.partial || jobs.some(job => hasPartialResult(job.result))
  if (failed || uncertain) {
    if (uncertain) await ScheduleCycleModel.updateOne({ cycleId, runId }, { $set: { hold: `Run ${run.name} requires review of interrupted or failed external actions` } })
    await ScheduleRunModel.updateOne({ _id: runId, stepIndex: run.stepIndex }, { $set: { status: 'failed', completedAt: now, partial, message: failed?.error || 'Job requires operator review' } })
    if (!uncertain) await ScheduleCycleModel.updateOne({ cycleId, runId }, { $unset: { runId: 1 } })
    return
  }
  const done = run.stepIndex + 1 === run.steps.length
  await ScheduleRunModel.updateOne({ _id: runId, stepIndex: run.stepIndex, status: 'running' }, {
    $set: { partial, message: done ? (partial ? 'Completed with individual failures' : 'Completed') : 'Waiting for next step', ...(done ? { status: partial ? 'partial' : 'completed', completedAt: now } : {}) },
    $inc: { stepIndex: 1 }
  })
  if (done) await ScheduleCycleModel.updateOne({ cycleId, runId }, { $unset: { runId: 1 } })
}

export async function tickJobSchedules(now = new Date()) {
  await Promise.all([JobScheduleModel.init(), ScheduleRunModel.init(), ScheduleCycleModel.init(), JobModel.init()])
  const schedules = await JobScheduleModel.find({ enabled: true }).sort({ _id: 1 }).lean()
  const localDate = detroitParts(now).date
  for (const schedule of schedules) {
    const dueAt = occurrenceOn(localDate, schedule.time)
    if (dueAt > now || dueAt <= schedule.eligibleAfter) continue
    const cycles = await CycleModel.find({ active: true }).select('_id').limit(2).lean()
    try {
      await ScheduleRunModel.updateOne({ scheduleId: String(schedule._id), localDate }, { $setOnInsert: {
        name: schedule.name, revision: schedule.revision, dueAt, steps: schedule.steps, dryRun: schedule.dryRun,
        actor: schedule.updatedBy, ...(cycles.length === 1 ? { cycleId: String(cycles[0]!._id), status: 'queued' } : { status: 'skipped', message: 'Exactly one active cycle is required', completedAt: now }),
        stepIndex: 0, partial: false
      } }, { upsert: true })
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error
    }
  }
  const cycleIds = await ScheduleRunModel.distinct('cycleId', { status: { $in: ['queued', 'running'] } })
  for (const cycleId of cycleIds) await reconcileCycle(cycleId, now)
}
