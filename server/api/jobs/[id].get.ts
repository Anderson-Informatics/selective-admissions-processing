import { JobModel } from '~~/server/models/Job'
import { Types } from 'mongoose'

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

  return job
})
