import { ReviewModel } from '~~/server/models/Review'

export default defineEventHandler(async (event) => {
  await connectDb()
  await requireAuth(event)

  const submissionId = getRouterParam(event, 'submissionId')
  const { cycleId } = getQuery(event) as Record<string, string>

  if (!cycleId || !submissionId) {
    throw createError({ statusCode: 400, statusMessage: 'cycleId and submissionId are required' })
  }

  const reviews = await ReviewModel.find({
    cycleId,
    submissionId,
    status: 'complete'
  })
    .select('stageName stageOrder requiredForProgress reviewerId score isAssigned completedAt createdBy status mappedData')
    .sort({ stageOrder: 1, completedAt: 1 })
    .lean()

  return { reviews }
})
