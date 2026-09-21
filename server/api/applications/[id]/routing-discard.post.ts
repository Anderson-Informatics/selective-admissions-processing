import { ReviewStageModel } from '~~/server/models/ReviewStage'

export default defineEventHandler(async (event) => {
  await connectDb()
  await requireAuth(event)
  const applicationId = getRouterParam(event, 'id')
  if (!applicationId) throw createError({ statusCode: 400, statusMessage: 'Application ID is required' })

  const stages = await ReviewStageModel.find({ applicationId }).lean()
  if (!stages.length) throw createError({ statusCode: 404, statusMessage: 'Application not found' })
  await ReviewStageModel.bulkWrite(stages.map(stage => ({
    updateOne: {
      filter: { _id: stage._id },
      update: { $set: { routingDraft: stage.routing, routingDraftUpdatedAt: new Date() } }
    }
  })))
  return { discarded: true }
})
