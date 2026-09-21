/* eslint-disable @typescript-eslint/no-explicit-any */
import { ApplicationModel } from '~~/server/models/Application'
import { ReviewStageModel } from '~~/server/models/ReviewStage'
import { routingConfigSchema, reviewStageRoleSchema, defaultRoutingConfig, collectReferencedStageIds } from '~~/server/utils/routingConfig'
import { recordConfigAudit } from '~~/server/utils/configAudit'

export default defineEventHandler(async (event) => {
  await connectDb()
  const user = await requireAuth(event)

  const body = await readBody(event)

  if (!body.cycleId || !body.name || !body.projectId) {
    throw createError({ statusCode: 400, statusMessage: 'cycleId, name, and projectId are required' })
  }

  const existing = await ApplicationModel.findOne({ cycleId: body.cycleId, projectId: body.projectId })
  if (existing) {
    throw createError({ statusCode: 409, statusMessage: 'This project is already mapped to an application for this cycle' })
  }

  const rawStages = Array.isArray(body.stages) ? body.stages : []
  const stageIds = new Set(rawStages.map((stage: any) => stage.stageId).filter(Boolean))
  if (stageIds.size !== rawStages.length) {
    throw createError({ statusCode: 400, statusMessage: 'Each stage must have a unique stageId' })
  }
  let parsedStages: any[]
  try {
    parsedStages = rawStages.map((stage: any) => ({
      ...stage,
      role: reviewStageRoleSchema.parse(stage.role || 'work'),
      routing: routingConfigSchema.parse(stage.routing || defaultRoutingConfig)
    }))
  } catch (error: any) {
    throw createError({ statusCode: 400, statusMessage: `Invalid routing configuration: ${error.message}` })
  }

  const stageIdSet = new Set(parsedStages.map(stage => stage.stageId))
  for (const stage of parsedStages) {
    const invalid = collectReferencedStageIds(stage.routing).some(stageId => !stageIdSet.has(stageId))
    if (invalid) throw createError({ statusCode: 400, statusMessage: 'Routing rules may only reference stages in this application' })
  }

  const application = await ApplicationModel.create({
    cycleId: body.cycleId,
    name: body.name,
    type: body.type || 'exam',
    projectId: body.projectId,
    initialFormId: body.initialFormId,
    active: body.active !== false
  })

  const stages = parsedStages.map((stage: any) => ({
    cycleId: body.cycleId,
    applicationId: String(application._id),
    projectId: body.projectId,
    stageId: stage.stageId,
    name: stage.name,
    type: stage.type || 'custom_review',
    formId: stage.formId,
    order: typeof stage.order === 'number' ? stage.order : 0,
    role: stage.role,
    routing: stage.routing,
    routingDraft: stage.routingDraft || stage.routing,
    routingDraftUpdatedAt: new Date(),
    routingDraftVersion: 1
  }))

  if (stages.length) {
    await ReviewStageModel.insertMany(stages)
  }

  const savedStages = await ReviewStageModel.find({ applicationId: String(application._id) }).lean()
  await recordConfigAudit({
    actor: user.email,
    cycleId: body.cycleId,
    applicationId: String(application._id),
    entityId: String(application._id),
    before: {},
    after: { application: application.toObject(), stages: savedStages }
  })

  return { ...application.toObject(), stages: savedStages }
})
