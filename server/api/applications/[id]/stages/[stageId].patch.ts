import { ApplicationModel } from '~~/server/models/Application'
import { ReviewStageModel } from '~~/server/models/ReviewStage'
import { normalizeRoutingConfig, collectReferencedStageIds } from '~~/server/utils/routingConfig'

export default defineEventHandler(async (event) => {
  await connectDb()
  await requireAuth(event)
  const applicationId = getRouterParam(event, 'id')
  const stageId = getRouterParam(event, 'stageId')
  const body = await readBody<{ routing?: unknown }>(event)
  if (!applicationId || !stageId) throw createError({ statusCode: 400, statusMessage: 'Application and stage are required' })

  const application = await ApplicationModel.findById(applicationId).lean()
  const stage = await ReviewStageModel.findOne({ applicationId, stageId })
  if (!application || !stage) throw createError({ statusCode: 404, statusMessage: 'Application stage not found' })

  let routing
  try {
    routing = normalizeRoutingConfig(body.routing)
  } catch (error: unknown) {
    throw createError({ statusCode: 400, statusMessage: error instanceof Error ? error.message : 'Invalid routing configuration' })
  }

  const applicationStages = await ReviewStageModel.find({ applicationId }).select('stageId').lean()
  const stageIds = new Set(applicationStages.map(item => item.stageId))
  if (collectReferencedStageIds(routing).some(id => !stageIds.has(id))) {
    throw createError({ statusCode: 400, statusMessage: 'Routing rules may only reference stages in this application' })
  }

  stage.routingDraft = routing
  stage.routingDraftUpdatedAt = new Date()
  stage.routingDraftVersion = (stage.routingDraftVersion || 0) + 1
  await stage.save()

  return {
    stageId,
    routingDraft: stage.routingDraft,
    routingDraftUpdatedAt: stage.routingDraftUpdatedAt,
    routingDraftVersion: stage.routingDraftVersion
  }
})
