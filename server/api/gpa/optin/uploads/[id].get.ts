import { Types } from 'mongoose'
import { GpaUploadModel } from '~~/server/models/GpaUpload'
import { JobModel } from '~~/server/models/Job'

export default defineEventHandler(async (event) => {
  await connectDb()
  const user = await requireAuth(event)
  const id = getRouterParam(event, 'id')
  if (!id || !Types.ObjectId.isValid(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid upload ID' })

  const upload = await GpaUploadModel.findOne({ _id: id, createdBy: user.email, source: 'opt_in' }).select('-files -records').lean()
  if (!upload) throw createError({ statusCode: 404, statusMessage: 'Opt-In GPA upload not found' })

  const jobId = upload.commitJobId || upload.previewJobId
  const job = jobId
    ? await JobModel.findById(jobId).select('status progress result error').lean()
    : null

  return { upload, job }
})
