import { JobModel } from '~~/server/models/Job'
import { Types } from 'mongoose'
import { RoutingBatchModel } from '../../models/RoutingBatch'

export default defineEventHandler(async (event) => {
  await connectDb()
  await requireAuth(event)

  const id = getRouterParam(event, 'id')
  if (!id || !Types.ObjectId.isValid(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid job ID' })
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
