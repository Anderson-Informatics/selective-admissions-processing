import { ESSAY_JOB_TYPES, JobModel } from '../../models/Job'
import { ExportFileModel } from '../../models/ExportFile'
import { recordDisclosure } from '../../utils/disclosureAudit'

export default defineEventHandler(async (event) => {
  await connectDb()
  const user = await requireAuth(event)
  const { jobId } = getQuery(event) as { jobId?: string }
  if (!jobId) {
    throw createError({ statusCode: 400, statusMessage: 'jobId is required' })
  }

  const job = await JobModel.findOne({ _id: jobId, type: { $in: ESSAY_JOB_TYPES } }).lean()
  const exportRef = job?.result?.export as { name?: string, base64?: string, exportFileId?: string } | undefined
  if (!job || !exportRef) {
    throw createError({ statusCode: 404, statusMessage: 'No export is available for this job' })
  }

  let data: Buffer | undefined
  let name = exportRef.name || 'essay-scoring.xlsx'
  if (exportRef.exportFileId) {
    const stored = await ExportFileModel.findById(exportRef.exportFileId).lean()
    if (!stored) {
      throw createError({ statusCode: 410, statusMessage: 'This export has expired. Re-run the job to generate a new one.' })
    }
    data = stored.data
    name = stored.name || name
  } else if (exportRef.base64) {
    data = Buffer.from(exportRef.base64, 'base64')
  }
  if (!data) {
    throw createError({ statusCode: 404, statusMessage: 'No export is available for this job' })
  }

  await recordDisclosure({
    actor: user.email,
    action: 'pii_export',
    entityType: 'job',
    entityId: jobId,
    detail: { jobType: job.type, cycleId: job.cycleId, file: name }
  })

  setResponseHeader(event, 'Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  setResponseHeader(event, 'Content-Disposition', `attachment; filename="${name}"`)
  return data
})
