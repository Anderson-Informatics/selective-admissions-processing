import { ApplicationModel } from '~~/server/models/Application'
import { FieldMappingModel } from '~~/server/models/FieldMapping'
import { MetadataModel } from '~~/server/models/Metadata'
import { ReviewStageModel } from '~~/server/models/ReviewStage'
import { buildFormFieldOptions } from '~~/server/utils/mergeFields'

export default defineEventHandler(async (event) => {
  await connectDb()
  await requireAuth(event)
  const applicationId = getRouterParam(event, 'id')
  if (!applicationId) throw createError({ statusCode: 400, statusMessage: 'Application ID is required' })

  const application = await ApplicationModel.findById(applicationId).lean()
  if (!application) throw createError({ statusCode: 404, statusMessage: 'Application not found' })
  const [stages, mappings, labels, team, forms] = await Promise.all([
    ReviewStageModel.find({ applicationId }).sort({ order: 1 }).lean(),
    FieldMappingModel.find({ cycleId: application.cycleId }).select('formId fieldId label canonicalName').lean(),
    MetadataModel.find({ type: 'label' }).sort({ name: 1 }).lean(),
    MetadataModel.find({ type: 'team' }).sort({ name: 1 }).lean(),
    MetadataModel.find({ type: 'form' }).lean()
  ])

  const formIds = new Set(stages.map(stage => stage.formId).filter(Boolean))
  if (application.initialFormId) formIds.add(application.initialFormId)
  const canonicalFields = [...new Set(mappings.filter(mapping => formIds.has(mapping.formId)).map(mapping => mapping.canonicalName).filter(Boolean))].sort()
  const reviewFields = stages.map(stage => ({
    stageId: stage.stageId,
    stageName: stage.name,
    fields: buildFormFieldOptions(stage.formId, mappings, forms)
  }))

  return {
    stages: stages.map(stage => ({ value: stage.stageId, label: stage.name, order: stage.order, role: stage.role })),
    fields: canonicalFields.map(field => ({ value: field, label: field })),
    reviewFields,
    rounds: (application.rounds || []).map(round => ({ value: round.key, label: round.name })),
    labels: labels.map(label => ({ value: label.externalId, label: label.name })),
    users: team.map(member => ({ value: member.externalId, label: member.name }))
  }
})
