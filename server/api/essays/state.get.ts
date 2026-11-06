import { ESSAY_JOB_TYPES, JobModel } from '../../models/Job'
import { resolveEssayContext } from '../../utils/essayScoring'

export default defineEventHandler(async (event) => {
  await connectDb()
  await requireAuth(event)
  const { cycleId } = getQuery(event) as { cycleId?: string }
  if (!cycleId) {
    throw createError({ statusCode: 400, statusMessage: 'cycleId is required' })
  }

  const [activeJob, lastJob] = await Promise.all([
    JobModel.findOne({
      cycleId,
      type: { $in: ESSAY_JOB_TYPES },
      status: { $in: ['pending', 'waiting', 'running'] }
    }).sort({ createdAt: -1 }).lean(),
    JobModel.findOne({
      cycleId,
      type: { $in: ESSAY_JOB_TYPES },
      status: { $in: ['completed', 'failed'] }
    }).sort({ completedAt: -1, createdAt: -1 }).lean()
  ])

  let essay: { applicationId: string, applicationName: string, essayStageId: string, essayStageName: string } | null
  try {
    const ctx = await resolveEssayContext(cycleId)
    essay = {
      applicationId: ctx.applicationId,
      applicationName: ctx.applicationName,
      essayStageId: ctx.essayStageId,
      essayStageName: ctx.essayStageName
    }
  } catch {
    essay = null
  }

  const serialize = (job: typeof activeJob) => {
    if (!job) return null
    const result = job.result ? { ...job.result } : undefined
    const exportFile = result?.export as { name?: string, base64?: string } | undefined
    if (result && exportFile) result.export = { name: exportFile.name }
    return {
      _id: String(job._id),
      type: job.type,
      status: job.status,
      progress: job.progress,
      error: job.error,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      createdAt: job.createdAt,
      result
    }
  }

  return { essay, activeJob: serialize(activeJob), lastJob: serialize(lastJob) }
})
