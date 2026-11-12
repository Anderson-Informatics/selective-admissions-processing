import { HSPTResultModel } from '~~/server/models/HSPTResult'
import { SubmissionModel } from '~~/server/models/Submission'
import { linkHSPTResult } from '~~/server/utils/hspt'
import { isWithdrawnSubmission } from '~~/server/utils/submissionStatus'

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

  const submission = await SubmissionModel.findOne({ submissionId: targetSubmissionId }).select('status').lean()
  if (isWithdrawnSubmission(submission || {})) {
    throw createError({ statusCode: 400, statusMessage: 'Cannot link an HSPT result to a withdrawn submission' })
  }

  const updated = await linkHSPTResult(id, targetSubmissionId)
  if (!updated) {
    throw createError({ statusCode: 404, statusMessage: 'HSPT result not found' })
  }

  return updated
})
