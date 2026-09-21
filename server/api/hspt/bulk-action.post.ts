import { HSPTResultModel } from '~~/server/models/HSPTResult'
import { linkHSPTResult, rejectHSPTResult } from '~~/server/utils/hspt'

export default defineEventHandler(async (event) => {
  await connectDb()
  await requireAuth(event)

  const body = await readBody<{
    cycleId?: string
    action?: 'accept' | 'reject'
    resultIds?: string[]
  }>(event)

  if (!body?.cycleId || !['accept', 'reject'].includes(body.action || '')) {
    throw createError({ statusCode: 400, statusMessage: 'cycleId and a valid action are required' })
  }

  const resultIds = [...new Set(body.resultIds || [])].slice(0, 100)
  if (!resultIds.length) {
    throw createError({ statusCode: 400, statusMessage: 'At least one HSPT result is required' })
  }

  const eligible = await HSPTResultModel.find({
    _id: { $in: resultIds },
    cycleId: body.cycleId,
    status: 'unlinked',
    linkedSubmissionId: { $exists: true, $ne: null },
    matchScore: { $lt: 1 }
  }).select('_id linkedSubmissionId').lean()

  await Promise.all(eligible.map(result => body.action === 'accept'
    ? linkHSPTResult(String(result._id), result.linkedSubmissionId!)
    : rejectHSPTResult(String(result._id))))

  return {
    processed: eligible.length,
    skipped: resultIds.length - eligible.length
  }
})
