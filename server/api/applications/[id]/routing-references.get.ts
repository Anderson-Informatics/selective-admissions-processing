import { ApplicationModel } from '~~/server/models/Application'
import { CycleModel } from '~~/server/models/Cycle'
import { FieldMappingModel } from '~~/server/models/FieldMapping'
import { MetadataModel } from '~~/server/models/Metadata'
import { ReviewStageModel } from '~~/server/models/ReviewStage'

export default defineEventHandler(async (event) => {
  await connectDb()
  await requireAuth(event)
  const applicationId = getRouterParam(event, 'id')
  if (!applicationId) throw createError({ statusCode: 400, statusMessage: 'Application ID is required' })

  const application = await ApplicationModel.findById(applicationId).lean()
  if (!application) throw createError({ statusCode: 404, statusMessage: 'Application not found' })
  const [cycle, stages, mappings, labels, team, forms] = await Promise.all([
    CycleModel.findById(application.cycleId).lean(),
    ReviewStageModel.find({ applicationId }).sort({ order: 1 }).lean(),
    FieldMappingModel.find({ cycleId: application.cycleId }).select('formId fieldId label canonicalName').lean(),
    MetadataModel.find({ type: 'label' }).sort({ name: 1 }).lean(),
    MetadataModel.find({ type: 'team' }).sort({ name: 1 }).lean(),
    MetadataModel.find({ type: 'form' }).lean()
  ])

  const formIds = new Set(stages.map(stage => stage.formId).filter(Boolean))
  if (application.initialFormId) formIds.add(application.initialFormId)
  const canonicalFields = [...new Set(mappings.filter(mapping => formIds.has(mapping.formId)).map(mapping => mapping.canonicalName).filter(Boolean))].sort()
  const reviewFields = stages.map((stage) => {
    const form = forms.find(item => item.externalId === stage.formId)
    const formLabels = new Map<string, string>((form?.data?.fields || []).map((field: { formFieldId: string, label?: string }) => [field.formFieldId, field.label || '']))
    const fields = mappings.filter(mapping => mapping.formId === stage.formId && mapping.canonicalName)
    const unique = new Map(fields.map((mapping) => {
      const [fieldId, subField] = mapping.fieldId.split(':')
      const questionText = [formLabels.get(fieldId || ''), subField].filter(Boolean).join(' - ') || mapping.label
      return [mapping.canonicalName, { value: mapping.canonicalName, label: mapping.canonicalName, questionText }]
    }))
    return { stageId: stage.stageId, stageName: stage.name, fields: [...unique.values()].sort((a, b) => a.label.localeCompare(b.label)) }
  })

  return {
    stages: stages.map(stage => ({ value: stage.stageId, label: stage.name, order: stage.order, role: stage.role })),
    fields: canonicalFields.map(field => ({ value: field, label: field })),
    reviewFields,
    rounds: (cycle?.rounds || []).map(round => ({ value: round.key, label: round.name })),
    labels: labels.map(label => ({ value: label.externalId, label: label.name })),
    users: team.map(member => ({ value: member.externalId, label: member.name }))
  }
})
