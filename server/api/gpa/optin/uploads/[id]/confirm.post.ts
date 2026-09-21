import { Types } from 'mongoose'
import { GpaUploadModel } from '~~/server/models/GpaUpload'
import { JobModel } from '~~/server/models/Job'

export default defineEventHandler(async (event) => {
  await connectDb()
  const user = await requireAuth(event)
  const id = getRouterParam(event, 'id')
  if (!id || !Types.ObjectId.isValid(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid upload ID' })

  const upload = await GpaUploadModel.findOneAndUpdate(
    { _id: id, createdBy: user.email, source: 'opt_in', status: 'ready' },
    { $set: { status: 'confirming', error: undefined } },
    { returnDocument: 'after' }
  )
  if (!upload) throw createError({ statusCode: 409, statusMessage: 'This upload is not ready for confirmation' })

  let job
  try {
    job = await JobModel.create({
      type: 'optin_gpa_commit',
      status: 'pending',
      cycleId: upload.cycleId,
      createdBy: user.email,
      payload: { uploadId: String(upload._id) },
      progress: { phase: 'queued', processed: 0, total: upload.files.length + 1, percent: 0, message: 'Import queued' }
    })
    await GpaUploadModel.findByIdAndUpdate(upload._id, { $set: { commitJobId: job._id } })
  } catch (error) {
    await GpaUploadModel.findByIdAndUpdate(upload._id, { $set: { status: 'ready' } })
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
      console.error('Immediate Opt-In GPA import dispatch failed; scheduled dispatch will retry', error)
    }
  }

  return { uploadId: String(upload._id), jobId: String(job._id) }
})
