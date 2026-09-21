import { HSPTResultModel } from '~~/server/models/HSPTResult'
import { linkHSPTResult } from '~~/server/utils/hspt'

export default defineEventHandler(async (event) => {
  await connectDb()
  await requireAuth(event)

  const { id } = getRouterParams(event)
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'HSPT result id is required' })
  }

  const body = await readBody<{ submissionId?: string }>(event) || {}
  let targetSubmissionId = body.submissionId

  if (!targetSubmissionId) {
    const result = await HSPTResultModel.findById(id).select('linkedSubmissionId').lean()
    targetSubmissionId = result?.linkedSubmissionId
  }

  if (!targetSubmissionId) {
    throw createError({ statusCode: 400, statusMessage: 'submissionId is required' })
  }

  const updated = await linkHSPTResult(id, targetSubmissionId)
  if (!updated) {
    throw createError({ statusCode: 404, statusMessage: 'HSPT result not found' })
  }

  return updated
})
