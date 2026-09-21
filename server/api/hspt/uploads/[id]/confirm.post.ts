import { Types } from 'mongoose'
import { HSPTUploadModel } from '~~/server/models/HSPTUpload'
import { JobModel } from '~~/server/models/Job'

export default defineEventHandler(async (event) => {
  await connectDb()
  const user = await requireAuth(event)
  const id = getRouterParam(event, 'id')
  if (!id || !Types.ObjectId.isValid(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid upload ID' })

  const upload = await HSPTUploadModel.findOneAndUpdate(
    { _id: id, createdBy: user.email, status: 'ready' },
    { $set: { status: 'confirming', error: undefined } },
    { returnDocument: 'after' }
  )
  if (!upload) throw createError({ statusCode: 409, statusMessage: 'This upload is not ready for confirmation' })

  let job
  try {
    job = await JobModel.create({
      type: 'hspt_upload_commit',
      status: 'pending',
      cycleId: upload.cycleId,
      createdBy: user.email,
      payload: { uploadId: String(upload._id) },
      progress: { phase: 'queued', processed: 0, total: upload.files.length + 1, percent: 0, message: 'Import queued' }
    })
    await HSPTUploadModel.findByIdAndUpdate(upload._id, { $set: { commitJobId: job._id } })
  } catch (error) {
    await HSPTUploadModel.findByIdAndUpdate(upload._id, { $set: { status: 'ready' } })
    throw error
  }

  if (!import.meta.dev) {
    const config = useRuntimeConfig()
    const origin = config.public.appUrl || getRequestURL(event).origin
    try {
      await fetch(`${origin}/.netlify/functions/dispatch-jobs`, {
        method: 'POST',
        headers: { 'x-job-dispatch-secret': config.jobDispatchSecret }
      })
    } catch (error) {
      console.error('Immediate HSPT import dispatch failed; scheduled dispatch will retry', error)
    }
  }

  return { uploadId: String(upload._id), jobId: String(job._id) }
})
