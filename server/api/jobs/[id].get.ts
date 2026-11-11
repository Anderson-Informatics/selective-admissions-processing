import { JobModel } from '~~/server/models/Job'
import { Types } from 'mongoose'
import { RoutingBatchModel } from '../../models/RoutingBatch'
import { requireDpscdAccess } from '../../utils/dpscdAuth'
import { recordDisclosure } from '../../utils/disclosureAudit'

export default defineEventHandler(async (event) => {
  const access = await requireDpscdAccess(event)
  await connectDb()

  const id = getRouterParam(event, 'id')
  if (!id || !Types.ObjectId.isValid(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid job ID' })
  }

  if (access.apiKey) {
    if (getQuery(event).batch != null) throw createError({ statusCode: 403, statusMessage: 'API key cannot access routing batches' })
    const job = await JobModel.findOne({ _id: id, type: 'dpscd_gpa_import', createdBy: access.email })
      .select('type status progress result error cycleId createdAt updatedAt').lean()
    if (!job) throw createError({ statusCode: 404, statusMessage: 'Job not found' })
    await recordDisclosure({ actor: access.email, action: 'data_api_disclosure', entityType: 'Job', entityId: id })
    return job
  }

  const job = await JobModel.findById(id).lean()
  if (!job) {
    throw createError({ statusCode: 404, statusMessage: 'Job not found' })
  }

  const batchIndex = getQuery(event).batch
  if (batchIndex != null) {
    const index = Number(batchIndex)
    if (!Number.isInteger(index) || index < 0) throw createError({ statusCode: 400, statusMessage: 'Invalid batch index' })
    const batch = await RoutingBatchModel.findOne({ jobId: id, index }).lean()
    if (!batch) throw createError({ statusCode: 404, statusMessage: 'Routing batch not found' })
    return batch
  }

  return job
})
