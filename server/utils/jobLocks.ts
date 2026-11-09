import { ESSAY_JOB_TYPES, JobModel, type JobType } from '../models/Job'

export function jobLock(type: JobType, cycleId: string) {
  if (type === 'run_routing') return { routingLock: cycleId }
  if (ESSAY_JOB_TYPES.includes(type)) return { essayLock: cycleId }
  return {}
}
export async function hasConflictingJob(type: JobType, cycleId: string, applicationId?: string) {
  if (type !== 'run_routing' && !ESSAY_JOB_TYPES.includes(type)) return false
  return !!await JobModel.exists({
    cycleId,
    type: type === 'run_routing' ? 'run_routing' : { $in: ESSAY_JOB_TYPES },
    status: { $in: ['pending', 'waiting', 'running'] },
    ...(type === 'run_routing' && applicationId ? { $or: [{ 'payload.applicationId': applicationId }, { 'payload.applicationId': { $exists: false } }] } : {})
  })
}
