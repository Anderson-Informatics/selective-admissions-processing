import { ESSAY_JOB_TYPES, JobModel, type JobType } from '../../models/Job'

const allowedTypes: JobType[] = [
  'metadata_sync',
  'submission_extraction',
  'form_response_mapping',
  'run_validation',
  'refresh_review_completion',
  'catchment_lookup',
  'run_routing',
  'score_compilation',
  ...ESSAY_JOB_TYPES
]

export default defineEventHandler(async (event) => {
  await connectDb()
  const user = await requireAuth(event)
  const body = await readBody(event)

  if (!allowedTypes.includes(body.type) || !body.cycleId) {
    throw createError({ statusCode: 400, statusMessage: 'A valid type and cycleId are required' })
  }

  if (ESSAY_JOB_TYPES.includes(body.type)) {
    const active = await JobModel.exists({
      cycleId: body.cycleId,
      type: { $in: ESSAY_JOB_TYPES },
      status: { $in: ['pending', 'waiting', 'running'] }
    })
    if (active) {
      throw createError({ statusCode: 409, statusMessage: 'An essay scoring job is already in progress for this cycle' })
    }
  }

  const job = await JobModel.create({
    type: body.type,
    status: 'pending',
    cycleId: body.cycleId,
    createdBy: user.email,
    payload: body.payload || {},
    progress: { phase: 'queued', processed: 0, total: 0, percent: 0, message: 'Queued' }
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
