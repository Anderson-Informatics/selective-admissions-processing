import { ApplicationModel } from '~~/server/models/Application'
import { ReviewStageModel } from '~~/server/models/ReviewStage'

export default defineEventHandler(async (event) => {
  await connectDb()
  await requireAuth(event)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Application ID is required' })
  }

  const application = await ApplicationModel.findByIdAndDelete(id)
  if (!application) {
    throw createError({ statusCode: 404, statusMessage: 'Application not found' })
  }

  await ReviewStageModel.deleteMany({ applicationId: id })

  return { ok: true }
})
