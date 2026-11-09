import { ScoreRecordModel } from '../../models/ScoreRecord'

export default defineEventHandler(async (event) => {
  await connectDb()
  await requireAuth(event)
  const { cycleId, applicationId } = getQuery(event) as { cycleId?: string, applicationId?: string }
  if (!cycleId) {
    throw createError({ statusCode: 400, statusMessage: 'cycleId is required' })
  }

  const filter: Record<string, unknown> = { cycleId }
  if (applicationId) filter.applicationId = applicationId
  return ScoreRecordModel.find(filter).sort({ applicationId: 1, submissionId: 1 }).limit(10000).lean()
})
