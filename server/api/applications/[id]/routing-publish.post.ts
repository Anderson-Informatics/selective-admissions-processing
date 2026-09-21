import { ApplicationModel } from '~~/server/models/Application'
import { ReviewStageModel } from '~~/server/models/ReviewStage'
import { recordConfigAudit } from '~~/server/utils/configAudit'
import { collectReferencedStageIds, normalizeRoutingConfig } from '~~/server/utils/routingConfig'

export default defineEventHandler(async (event) => {
  await connectDb()
  const user = await requireAuth(event)
  const applicationId = getRouterParam(event, 'id')
  if (!applicationId) throw createError({ statusCode: 400, statusMessage: 'Application ID is required' })

  const application = await ApplicationModel.findById(applicationId).lean()
  const stages = await ReviewStageModel.find({ applicationId }).sort({ order: 1 }).lean()
  if (!application) throw createError({ statusCode: 404, statusMessage: 'Application not found' })

  const stageIds = new Set(stages.map(stage => stage.stageId))
  const parsed = stages.map(stage => ({
    stage,
    routing: normalizeRoutingConfig(stage.routingDraft || stage.routing)
  }))
  const initialCount = parsed.filter(({ stage }) => stage.role === 'initial').length
  if (initialCount !== 1) throw createError({ statusCode: 400, statusMessage: 'Exactly one stage must have the initial role before publishing' })
  for (const item of parsed) {
    if (collectReferencedStageIds(item.routing).some(id => !stageIds.has(id))) {
      throw createError({ statusCode: 400, statusMessage: `Stage ${item.stage.name} references a stage outside this application` })
    }
  }

  const before = { stages }
  const publishedAt = new Date()
  await Promise.all(parsed.map(({ stage, routing }) => ReviewStageModel.updateOne(
    { _id: stage._id },
    { $set: { routing, routingPublishedAt: publishedAt, routingPublishedBy: user.email, routingDraft: routing } }
  )))
  const updatedStages = await ReviewStageModel.find({ applicationId }).sort({ order: 1 }).lean()
  await recordConfigAudit({
    actor: user.email,
    cycleId: application.cycleId,
    applicationId,
    entityId: applicationId,
    before,
    after: { stages: updatedStages }
  })

  return { published: true, publishedAt, stages: updatedStages }
})
