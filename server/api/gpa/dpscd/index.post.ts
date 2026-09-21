import { GpaUploadModel } from '~~/server/models/GpaUpload'
import { JobModel } from '~~/server/models/Job'
import { parseDpscdBody } from '~~/server/utils/gpa'

const maxPayloadBytes = 8 * 1024 * 1024

export default defineEventHandler(async (event) => {
  await connectDb()
  const user = await requireAuth(event)

  const raw = await readRawBody(event)
  if (!raw) throw createError({ statusCode: 400, statusMessage: 'Request body is required' })
  if (raw.length > maxPayloadBytes) throw createError({ statusCode: 413, statusMessage: 'Payload cannot exceed 8 MB' })

  const parsed = parseDpscdBody(raw)
  const cycleId = parsed.cycleId || String(getQuery(event).cycleId || '')
  const { records } = parsed
  if (!cycleId) throw createError({ statusCode: 400, statusMessage: 'cycleId is required (in the body envelope or as a query parameter)' })
  if (!records.length) throw createError({ statusCode: 400, statusMessage: 'At least one record is required' })

  const upload = await GpaUploadModel.create({
    cycleId,
    createdBy: user.email,
    source: 'dpscd',
    status: 'importing',
    records,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60_000)
  })
  const job = await JobModel.create({
    type: 'dpscd_gpa_import',
    status: 'pending',
    cycleId,
    createdBy: user.email,
    payload: { uploadId: String(upload._id) },
    progress: { phase: 'queued', processed: 0, total: records.length, percent: 0, message: 'Import queued' }
  })
  await GpaUploadModel.findByIdAndUpdate(upload._id, { $set: { importJobId: job._id } })

  if (!import.meta.dev) {
    const config = useRuntimeConfig()
    const origin = config.public.appUrl || getRequestURL(event).origin
    try {
      await fetch(`${origin}/.netlify/functions/dispatch-jobs`, {
        method: 'POST',
        headers: { 'x-job-dispatch-secret': config.jobDispatchSecret }
      })
    } catch (error) {
      console.error('Immediate DPSCD GPA import dispatch failed; scheduled dispatch will retry', error)
    }
  }

  return { uploadId: String(upload._id), jobId: String(job._id), records: records.length }
})
