import { SubmissionModel } from '~~/server/models/Submission'
import { ensureCatchmentZonesSeeded, processSubmissionCatchment } from '~~/server/utils/catchment'

export default defineEventHandler(async (event) => {
  await connectDb()
  await requireAuth(event)

  const submissionId = getRouterParam(event, 'submissionId')
  const { cycleId } = getQuery(event) as Record<string, string>

  if (!cycleId || !submissionId) {
    throw createError({ statusCode: 400, statusMessage: 'cycleId and submissionId are required' })
  }

  const hereApiKey = useRuntimeConfig().hereApiKey
  if (!hereApiKey) {
    throw createError({ statusCode: 500, statusMessage: 'NUXT_HERE_API_KEY is not configured' })
  }

  const submission = await SubmissionModel.findOne({ cycleId, submissionId })
    .select('submissionId mappedFields geocode catchment')
    .lean()

  if (!submission) {
    throw createError({ statusCode: 404, statusMessage: 'Submission not found' })
  }

  await ensureCatchmentZonesSeeded()
  const result = await processSubmissionCatchment(submission, { hereApiKey, force: true })

  const updated = await SubmissionModel.findOne({ cycleId, submissionId })
    .select('geocode catchment')
    .lean()

  return { result, geocode: updated?.geocode, catchment: updated?.catchment }
})
