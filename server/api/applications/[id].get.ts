import { ApplicationModel } from '~~/server/models/Application'
import { ReviewStageModel } from '~~/server/models/ReviewStage'

export default defineEventHandler(async (event) => {
  await connectDb()
  await requireAuth(event)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Application ID is required' })
  }

  const [application, stages] = await Promise.all([
    ApplicationModel.findById(id).lean(),
    ReviewStageModel.find({ applicationId: id }).sort({ order: 1 }).lean()
  ])

  if (!application) {
    throw createError({ statusCode: 404, statusMessage: 'Application not found' })
  }

  return { ...application, stages }
})
