import { Types } from 'mongoose'
import { HSPTUploadModel } from '~~/server/models/HSPTUpload'
import { JobModel } from '~~/server/models/Job'

export default defineEventHandler(async (event) => {
  await connectDb()
  const user = await requireAuth(event)
  const id = getRouterParam(event, 'id')
  if (!id || !Types.ObjectId.isValid(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid upload ID' })

  const upload = await HSPTUploadModel.findOne({ _id: id, createdBy: user.email }).select('-files').lean()
  if (!upload) throw createError({ statusCode: 404, statusMessage: 'HSPT upload not found' })

  const jobId = upload.commitJobId || upload.previewJobId
  const job = jobId
    ? await JobModel.findById(jobId).select('status progress result error').lean()
    : null

  return { upload, job }
})
