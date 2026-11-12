import { ScoreRecordModel } from '../../models/ScoreRecord'
import { SubmissionModel } from '../../models/Submission'

export default defineEventHandler(async (event) => {
  await connectDb()
  await requireAuth(event)
  const { cycleId, applicationId } = getQuery(event) as { cycleId?: string, applicationId?: string }
  if (!cycleId) {
    throw createError({ statusCode: 400, statusMessage: 'cycleId is required' })
  }

  const filter: Record<string, unknown> = { cycleId }
  if (applicationId) filter.applicationId = applicationId
  const withdrawnIds = await SubmissionModel.distinct('submissionId', { cycleId, status: /^withdrawn$/i })
  if (withdrawnIds.length) filter.submissionId = { $nin: withdrawnIds }
  return ScoreRecordModel.find(filter).sort({ applicationId: 1, submissionId: 1 }).limit(10000).lean()
})
