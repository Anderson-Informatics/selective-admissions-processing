import { ESSAY_JOB_TYPES, JobModel } from '../../models/Job'

export default defineEventHandler(async (event) => {
  await connectDb()
  await requireAuth(event)
  const { jobId } = getQuery(event) as { jobId?: string }
  if (!jobId) {
    throw createError({ statusCode: 400, statusMessage: 'jobId is required' })
  }

  const job = await JobModel.findOne({ _id: jobId, type: { $in: ESSAY_JOB_TYPES } }).lean()
  const exportFile = job?.result?.export as { name?: string, base64?: string } | undefined
  if (!job || !exportFile?.base64) {
    throw createError({ statusCode: 404, statusMessage: 'No export is available for this job' })
  }

  setResponseHeader(event, 'Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  setResponseHeader(event, 'Content-Disposition', `attachment; filename="${exportFile.name || 'essay-scoring.xlsx'}"`)
  return Buffer.from(exportFile.base64, 'base64')
})
