import { ESSAY_JOB_TYPES, JobModel, type JobType } from '../../models/Job'
import { hasConflictingJob, jobLock } from '../../utils/jobLocks'

const allowedTypes: JobType[] = [
  'metadata_sync',
  'submission_extraction',
  'form_response_mapping',
  'run_validation',
  'refresh_review_completion',
  'gpa_status_label_sync',
  'catchment_lookup',
  'run_routing',
  'score_compilation',
  'registration_sync',
  ...ESSAY_JOB_TYPES
]

export default defineEventHandler(async (event) => {
  await connectDb()
  const user = await requireAuth(event)
  const body = await readBody(event)

  if (!allowedTypes.includes(body.type) || !body.cycleId) {
    throw createError({ statusCode: 400, statusMessage: 'A valid type and cycleId are required' })
  }

  if (body.type === 'run_routing') {
    const payload = body.payload || {}
    if ((payload.scope != null && !['limited', 'all'].includes(payload.scope))
      || (payload.limit != null && (!Number.isInteger(payload.limit) || payload.limit < 1 || payload.limit > 5000))
      || (payload.applicationId != null && typeof payload.applicationId !== 'string')
      || (payload.labelId != null && typeof payload.labelId !== 'string')
      || (payload.currentStageId != null && typeof payload.currentStageId !== 'string')
      || (payload.dryRun != null && typeof payload.dryRun !== 'boolean')
      || (payload.excludeSubmissionIds != null && (!Array.isArray(payload.excludeSubmissionIds) || !payload.excludeSubmissionIds.every((id: unknown) => typeof id === 'string')))) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid routing scope, limit, filters, or dry-run setting' })
    }
    const active = await hasConflictingJob(body.type, body.cycleId, payload.applicationId)
    if (active) throw createError({ statusCode: 409, statusMessage: 'An overlapping routing job is already in progress' })
    body.payload = { scope: payload.scope || 'limited', applicationId: payload.applicationId, labelId: payload.labelId, currentStageId: payload.currentStageId, limit: payload.limit || 250, dryRun: payload.dryRun === true, excludeSubmissionIds: payload.excludeSubmissionIds }
  }

  if (body.type === 'gpa_status_label_sync') {
    const payload = body.payload || {}
    if ((payload.applicationId != null && typeof payload.applicationId !== 'string')
      || (payload.dryRun != null && typeof payload.dryRun !== 'boolean')) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid GPA label sync scope or dry-run setting' })
    }
    body.payload = { applicationId: payload.applicationId, dryRun: payload.dryRun === true }
  }

  if (ESSAY_JOB_TYPES.includes(body.type)) {
    const active = await hasConflictingJob(body.type, body.cycleId)
    if (active) {
      throw createError({ statusCode: 409, statusMessage: 'An essay scoring job is already in progress for this cycle' })
    }
  }

  if (body.type === 'run_routing' || ESSAY_JOB_TYPES.includes(body.type)) await JobModel.init()
  const job = await JobModel.create({
    type: body.type,
    ...jobLock(body.type, body.cycleId),
    status: 'pending',
    cycleId: body.cycleId,
    createdBy: user.email,
    payload: body.payload || {},
    progress: { phase: 'queued', processed: 0, total: 0, percent: 0, message: 'Queued' }
  }).catch((error: unknown) => {
    if ((error as { code?: number }).code === 11000 && (body.type === 'run_routing' || ESSAY_JOB_TYPES.includes(body.type))) {
      throw createError({ statusCode: 409, statusMessage: 'A routing or essay job is already in progress for this cycle' })
    }
    throw error
  })

  if (!import.meta.dev) {
    const config = useRuntimeConfig()
    const origin = config.public.appUrl || getRequestURL(event).origin
    try {
      await fetch(`${origin}/.netlify/functions/dispatch-jobs`, {
        method: 'POST',
        headers: { 'x-job-dispatch-secret': config.jobDispatchSecret }
      })
    } catch (error) {
      console.error('Immediate job dispatch failed; scheduled dispatch will retry', error)
    }
  }

  return job.toObject()
})
