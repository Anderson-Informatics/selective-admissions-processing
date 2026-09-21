import { ApplicationModel } from '~~/server/models/Application'
import { ReviewStageModel } from '~~/server/models/ReviewStage'

export default defineEventHandler(async (event) => {
  await connectDb()
  await requireAuth(event)

  const { cycleId } = getQuery(event) as { cycleId?: string }
  if (!cycleId) {
    throw createError({ statusCode: 400, statusMessage: 'cycleId is required' })
  }

  const [applications, stages] = await Promise.all([
    ApplicationModel.find({ cycleId }).sort({ name: 1 }).lean(),
    ReviewStageModel.find({ cycleId }).sort({ order: 1 }).lean()
  ])

  const stagesByApplication = stages.reduce<Record<string, typeof stages>>((acc, stage) => {
    const key = String(stage.applicationId)
    if (!acc[key]) acc[key] = []
    acc[key].push(stage)
    return acc
  }, {})

  return applications.map(application => ({
    ...application,
    stages: stagesByApplication[String(application._id)] || []
  }))
})
