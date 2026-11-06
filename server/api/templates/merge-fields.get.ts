import { ApplicationModel } from '~~/server/models/Application'
import { CycleModel } from '~~/server/models/Cycle'
import { FieldMappingModel } from '~~/server/models/FieldMapping'
import { MetadataModel } from '~~/server/models/Metadata'
import { ReviewStageModel } from '~~/server/models/ReviewStage'
import { CANONICAL_FIELDS } from '~~/server/utils/legacyFieldMap'
import { buildMergeFieldSources } from '~~/server/utils/mergeFields'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  await connectDb()
  const { cycleId: requestedCycleId } = getQuery(event)
  const cycle = typeof requestedCycleId === 'string' && requestedCycleId
    ? await CycleModel.findById(requestedCycleId).lean()
    : await CycleModel.findOne({ active: true }).sort({ year: -1 }).lean()

  if (!cycle) {
    return { cycleId: null, sources: buildMergeFieldSources({ applications: [], stages: [], mappings: [], forms: [], fallbackFields: CANONICAL_FIELDS }) }
  }

  const cycleId = String(cycle._id)
  const [applications, stages, mappings, forms] = await Promise.all([
    ApplicationModel.find({ cycleId }).select('initialFormId').lean(),
    ReviewStageModel.find({ cycleId }).select('name formId order').sort({ order: 1 }).lean(),
    FieldMappingModel.find({ cycleId }).select('formId fieldId label canonicalName').lean(),
    MetadataModel.find({ type: 'form' }).select('externalId name data.fields').lean()
  ])

  return {
    cycleId,
    sources: buildMergeFieldSources({ applications, stages, mappings, forms, fallbackFields: CANONICAL_FIELDS })
  }
})
