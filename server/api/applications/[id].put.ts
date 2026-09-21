/* eslint-disable @typescript-eslint/no-explicit-any */
import { ApplicationModel } from '~~/server/models/Application'
import { ReviewStageModel } from '~~/server/models/ReviewStage'
import { routingConfigSchema, reviewStageRoleSchema, defaultRoutingConfig, collectReferencedStageIds } from '~~/server/utils/routingConfig'
import { recordConfigAudit } from '~~/server/utils/configAudit'

export default defineEventHandler(async (event) => {
  await connectDb()
  const user = await requireAuth(event)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Application ID is required' })
  }

  const body = await readBody(event)

  const application = await ApplicationModel.findById(id)
  const previousStages = application ? await ReviewStageModel.find({ applicationId: id }).lean() : []
  if (!application) {
    throw createError({ statusCode: 404, statusMessage: 'Application not found' })
  }

  if (body.projectId && body.projectId !== application.projectId) {
    const existing = await ApplicationModel.findOne({
      cycleId: application.cycleId,
      projectId: body.projectId,
      _id: { $ne: id }
    })
    if (existing) {
      throw createError({ statusCode: 409, statusMessage: 'This project is already mapped to an application for this cycle' })
    }
    application.projectId = body.projectId
  }

  if (body.name !== undefined) application.name = body.name
  if (body.type !== undefined) application.type = body.type
  if (body.initialFormId !== undefined) application.initialFormId = body.initialFormId
  if (body.active !== undefined) application.active = body.active === true

  let stages: any[] | undefined
  if (Array.isArray(body.stages)) {
    const stageIds = new Set(body.stages.map((stage: any) => stage.stageId).filter(Boolean))
    if (stageIds.size !== body.stages.length) {
      throw createError({ statusCode: 400, statusMessage: 'Each stage must have a unique stageId' })
    }

    try {
      stages = body.stages.map((stage: any) => ({
        cycleId: application.cycleId,
        applicationId: id,
        projectId: application.projectId,
        stageId: stage.stageId,
        name: stage.name,
        type: stage.type || 'custom_review',
        formId: stage.formId,
        order: typeof stage.order === 'number' ? stage.order : 0,
        role: reviewStageRoleSchema.parse(stage.role || 'work'),
        routing: routingConfigSchema.parse(stage.routing || defaultRoutingConfig),
        routingDraft: routingConfigSchema.parse(stage.routingDraft || stage.routing || defaultRoutingConfig),
        routingDraftUpdatedAt: new Date(),
        routingDraftVersion: (typeof stage.routingDraftVersion === 'number' ? stage.routingDraftVersion : 0) + 1
      }))
    } catch (error: any) {
      throw createError({ statusCode: 400, statusMessage: `Invalid routing configuration: ${error.message}` })
    }

    if (!stages) throw createError({ statusCode: 400, statusMessage: 'Invalid stage configuration' })
    const stageIdSet = new Set(stages.map(stage => stage.stageId))
    for (const stage of stages) {
      const invalid = collectReferencedStageIds(stage.routing).some(stageId => !stageIdSet.has(stageId))
      if (invalid) throw createError({ statusCode: 400, statusMessage: 'Routing rules may only reference stages in this application' })
    }
  }

  const previousConfig = { application: application.toObject(), stages: previousStages }
  await application.save()
  if (stages) {
    await ReviewStageModel.deleteMany({ applicationId: id })
    if (stages.length) await ReviewStageModel.insertMany(stages)
  }

  const updatedStages = await ReviewStageModel.find({ applicationId: id }).sort({ order: 1 }).lean()
  await recordConfigAudit({
    actor: user.email,
    cycleId: application.cycleId,
    applicationId: id,
    entityId: id,
    before: previousConfig,
    after: { application: application.toObject(), stages: updatedStages }
  })
  return { ...application.toObject(), stages: updatedStages }
})
