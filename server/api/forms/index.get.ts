/* eslint-disable @typescript-eslint/no-explicit-any */
import { ApplicationModel } from '~~/server/models/Application'
import { FieldMappingModel } from '~~/server/models/FieldMapping'
import { MetadataModel } from '~~/server/models/Metadata'
import { ReviewStageModel } from '~~/server/models/ReviewStage'

interface FormStatus {
  formId: string
  name: string
  applicationId: string
  applicationName: string
  type: 'initial' | 'review'
  stageNames: string[]
  mappableFieldCount: number
  mappedFieldCount: number
  isMapped: boolean
  isComplete: boolean
}

function mappableFieldCount(fields: any[] = []): number {
  let count = 0
  for (const f of fields) {
    if (f.fieldType === 'text_only' || f.fieldType === 'divider') continue
    if (f.fieldType === 'name') count += 2
    else if (f.fieldType === 'address') count += 6
    else count += 1
  }
  return count
}

export default defineEventHandler(async (event) => {
  await connectDb()
  await requireAuth(event)

  const { cycleId } = getQuery(event) as { cycleId?: string }
  if (!cycleId) {
    throw createError({ statusCode: 400, statusMessage: 'cycleId is required' })
  }

  const [applications, stages, mappings] = await Promise.all([
    ApplicationModel.find({ cycleId }).lean(),
    ReviewStageModel.find({ cycleId }).lean(),
    FieldMappingModel.find({ cycleId }).lean()
  ])

  const appById: Record<string, any> = {}
  for (const a of applications) appById[String(a._id)] = a

  const formToApp: Record<string, { applicationId: string, type: 'initial' | 'review', stageNames: string[] }> = {}
  for (const a of applications) {
    if (a.initialFormId) {
      formToApp[a.initialFormId] = { applicationId: String(a._id), type: 'initial', stageNames: [] }
    }
  }
  for (const s of stages) {
    if (s.formId) {
      const existing = formToApp[s.formId]
      if (existing) {
        existing.type = 'review'
        if (!existing.stageNames.includes(s.name)) existing.stageNames.push(s.name)
      } else {
        formToApp[s.formId] = { applicationId: String(s.applicationId), type: 'review', stageNames: [s.name] }
      }
    }
  }

  const metadata = await MetadataModel.find({
    type: 'form',
    externalId: { $in: Object.keys(formToApp) }
  }).sort({ updatedAt: -1 }).lean()
  const metadataByFormId: Record<string, any> = {}
  for (const m of metadata) {
    if (!metadataByFormId[m.externalId]) metadataByFormId[m.externalId] = m
  }

  const mappedCountByForm: Record<string, number> = {}
  for (const m of mappings) {
    mappedCountByForm[m.formId] = (mappedCountByForm[m.formId] || 0) + 1
  }

  const forms: FormStatus[] = []
  for (const formId of Object.keys(formToApp)) {
    const meta = metadataByFormId[formId]
    const mapping = formToApp[formId]
    if (!mapping) continue
    const app = appById[mapping.applicationId]
    const mappable = mappableFieldCount(meta?.data?.fields)
    const mapped = mappedCountByForm[formId] || 0
    forms.push({
      formId,
      name: meta?.data?.name || meta?.name || formId,
      applicationId: mapping.applicationId,
      applicationName: app?.name || 'Unknown',
      type: mapping.type,
      stageNames: mapping.stageNames,
      mappableFieldCount: mappable,
      mappedFieldCount: mapped,
      isMapped: mapped > 0,
      isComplete: mappable > 0 && mapped >= mappable
    })
  }

  return forms
})
