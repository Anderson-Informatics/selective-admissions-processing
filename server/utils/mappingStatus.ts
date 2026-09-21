import { ApplicationModel } from '../models/Application'
import { FieldMappingModel } from '../models/FieldMapping'
import { MetadataModel } from '../models/Metadata'
import { ReviewStageModel } from '../models/ReviewStage'

export interface MappedFormManifestItem {
  formId: string
  formName: string
}

export interface ReviewStageContext {
  applicationId: string
  stageName: string
  stageOrder: number
  requiredForProgress: boolean
}

export interface CycleEntryContext {
  applicationIdByProjectId: Record<string, string>
  stageNameByFormAndProject: Record<string, string>
  reviewStageByFormAndStage: Record<string, ReviewStageContext>
  reviewStageByApplicationAndStage: Record<string, { stageName: string, stageOrder: number }>
}

export async function getMappedFormIds(cycleId: string): Promise<string[]> {
  const formIds = await FieldMappingModel.distinct('formId', {
    cycleId,
    canonicalName: { $ne: '' }
  })

  return [...new Set(formIds.filter(Boolean))].sort()
}

export async function getMappedFormManifest(cycleId: string): Promise<MappedFormManifestItem[]> {
  const formIds = await getMappedFormIds(cycleId)
  if (!formIds.length) return []

  const metadata = await MetadataModel.find({
    type: 'form',
    externalId: { $in: formIds }
  }).sort({ updatedAt: -1 }).lean()

  const nameByFormId: Record<string, string> = {}
  for (const item of metadata) {
    if (!nameByFormId[item.externalId]) {
      nameByFormId[item.externalId] = item.data?.name || item.name
    }
  }

  return formIds.map(formId => ({
    formId,
    formName: nameByFormId[formId] || formId
  }))
}

export async function getCycleEntryContext(cycleId: string): Promise<CycleEntryContext> {
  const [applications, stages] = await Promise.all([
    ApplicationModel.find({ cycleId }).lean(),
    ReviewStageModel.find({ cycleId }).lean()
  ])

  const applicationIdByProjectId: Record<string, string> = {}
  for (const application of applications) {
    applicationIdByProjectId[application.projectId] = String(application._id)
  }

  const stageNameByFormAndProject: Record<string, string> = {}
  const reviewStageByFormAndStage: Record<string, ReviewStageContext> = {}
  const reviewStageByApplicationAndStage: Record<string, { stageName: string, stageOrder: number }> = {}
  for (const stage of stages) {
    if (stage.formId) {
      stageNameByFormAndProject[`${stage.formId}|${stage.projectId}`] = stage.name
      reviewStageByFormAndStage[`${stage.formId}|${stage.stageId}`] = {
        applicationId: String(stage.applicationId),
        stageName: stage.name,
        stageOrder: stage.order,
        requiredForProgress: stage.role !== 'final'
      }
    }
    if (stage.applicationId && stage.stageId) {
      reviewStageByApplicationAndStage[`${stage.applicationId}|${stage.stageId}`] = {
        stageName: stage.name,
        stageOrder: stage.order
      }
    }
  }

  return { applicationIdByProjectId, stageNameByFormAndProject, reviewStageByFormAndStage, reviewStageByApplicationAndStage }
}

export async function getApplicationIdsWithMappings(cycleId: string): Promise<string[]> {
  const [formIds, applications, stages] = await Promise.all([
    getMappedFormIds(cycleId),
    ApplicationModel.find({ cycleId }).lean(),
    ReviewStageModel.find({ cycleId }).lean()
  ])
  const mappedForms = new Set(formIds)
  const applicationIds = new Set<string>()

  for (const application of applications) {
    if (application.initialFormId && mappedForms.has(application.initialFormId)) {
      applicationIds.add(String(application._id))
    }
  }
  for (const stage of stages) {
    if (stage.formId && mappedForms.has(stage.formId)) {
      applicationIds.add(stage.applicationId)
    }
  }

  return [...applicationIds]
}
