import { ReviewStageModel } from '~~/server/models/ReviewStage'

export default defineEventHandler(async (event) => {
  await connectDb()
  await requireAuth(event)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Application ID is required' })
  }

  const stages = await ReviewStageModel.find({ applicationId: id })
    .select('stageId name')
    .sort({ order: 1 })
    .lean()

  return stages.map(stage => ({ value: stage.stageId, label: stage.name }))
})
