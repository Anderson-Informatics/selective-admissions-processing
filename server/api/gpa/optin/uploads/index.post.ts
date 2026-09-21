import { GpaUploadModel } from '~~/server/models/GpaUpload'
import { JobModel } from '~~/server/models/Job'

const maxUploadBytes = 16 * 1024 * 1024

export default defineEventHandler(async (event) => {
  await connectDb()
  const user = await requireAuth(event)
  const parts = await readMultipartFormData(event)
  if (!parts?.length) throw createError({ statusCode: 400, statusMessage: 'No files uploaded' })

  let cycleId = ''
  const files: { name: string, content: string, size: number }[] = []
  let totalBytes = 0

  for (const part of parts) {
    if (part.name === 'cycleId') {
      cycleId = part.data.toString('utf8')
    } else if (part.filename) {
      const lower = part.filename.toLowerCase()
      if (!lower.endsWith('.xlsx') && !lower.endsWith('.xls')) {
        throw createError({ statusCode: 400, statusMessage: `${part.filename} is not an Excel file` })
      }
      totalBytes += part.data.length
      files.push({ name: part.filename, content: part.data.toString('base64'), size: part.data.length })
    }
  }

  if (!cycleId) throw createError({ statusCode: 400, statusMessage: 'cycleId is required' })
  if (!files.length) throw createError({ statusCode: 400, statusMessage: 'At least one Excel file is required' })
  if (totalBytes > maxUploadBytes) throw createError({ statusCode: 413, statusMessage: 'Uploads cannot exceed 16 MB total' })

  const upload = await GpaUploadModel.create({
    cycleId,
    createdBy: user.email,
    source: 'opt_in',
    status: 'previewing',
    files,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60_000)
  })
  const job = await JobModel.create({
    type: 'optin_gpa_preview',
    status: 'pending',
    cycleId,
    createdBy: user.email,
    payload: { uploadId: String(upload._id) },
    progress: { phase: 'queued', processed: 0, total: files.length + 1, percent: 0, message: 'Preview queued' }
  })
  await GpaUploadModel.findByIdAndUpdate(upload._id, { $set: { previewJobId: job._id } })

  if (!import.meta.dev) {
    const config = useRuntimeConfig()
    const origin = config.public.appUrl || getRequestURL(event).origin
    try {
      await fetch(`${origin}/.netlify/functions/dispatch-jobs`, {
        method: 'POST',
        headers: { 'x-job-dispatch-secret': config.jobDispatchSecret }
      })
    } catch (error) {
      console.error('Immediate Opt-In GPA preview dispatch failed; scheduled dispatch will retry', error)
    }
  }

  return { uploadId: String(upload._id), jobId: String(job._id) }
})
