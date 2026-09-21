import { ApplicationModel } from '~~/server/models/Application'
import { ReviewStageModel } from '~~/server/models/ReviewStage'
import { recordConfigAudit } from '~~/server/utils/configAudit'
import { resolveRoutingTemplate } from '~~/server/utils/routingTemplates'

export default defineEventHandler(async (event) => {
  await connectDb()
  const user = await requireAuth(event)
  const id = getRouterParam(event, 'id')
  const body = await readBody<{ templateKey?: string }>(event)
  if (!id || !body.templateKey) throw createError({ statusCode: 400, statusMessage: 'Application ID and templateKey are required' })

  const application = await ApplicationModel.findById(id)
  if (!application) throw createError({ statusCode: 404, statusMessage: 'Application not found' })
  const previousStages = await ReviewStageModel.find({ applicationId: id }).sort({ order: 1 }).lean()
  let resolved
  try {
    resolved = resolveRoutingTemplate(body.templateKey, previousStages as unknown as Array<Record<string, unknown>>)
  } catch (error: unknown) {
    throw createError({ statusCode: 400, statusMessage: error instanceof Error ? error.message : 'Invalid routing template' })
  }

  for (const stage of resolved.stages) {
    await ReviewStageModel.updateOne(
      { applicationId: id, stageId: stage.stageId },
      { $set: { role: stage.role, routingDraft: stage.routing, routingDraftUpdatedAt: new Date() }, $inc: { routingDraftVersion: 1 } }
    )
  }

  const updatedStages = await ReviewStageModel.find({ applicationId: id }).sort({ order: 1 }).lean()
  await recordConfigAudit({
    actor: user.email,
    cycleId: application.cycleId,
    applicationId: id,
    entityId: id,
    before: { stages: previousStages },
    after: { stages: updatedStages }
  })

  return {
    application: application.toObject(),
    stages: updatedStages,
    template: { name: resolved.name, draft: resolved.draft },
    warnings: resolved.warnings
  }
})
