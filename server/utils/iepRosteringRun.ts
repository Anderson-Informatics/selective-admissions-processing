import { ApplicationModel } from '../models/Application'
import { CycleModel } from '../models/Cycle'
import { MetadataModel } from '../models/Metadata'
import { SubmissionModel } from '../models/Submission'
import { ReviewModel } from '../models/Review'
import { ReviewStageModel } from '../models/ReviewStage'
import { FieldMappingModel } from '../models/FieldMapping'
import { buildIepRoster } from './iepRostering'
import { normalizeExamSchedulingConfig, type ExamReviewInput, type SchedulableSubmission } from './examScheduling'

export async function loadIepRoster(cycleId: string) {
  const cycle = await CycleModel.findById(cycleId).select('examScheduling').lean()
  if (!cycle) throw createError({ statusCode: 404, statusMessage: 'Cycle not found' })
  const config = normalizeExamSchedulingConfig(cycle.examScheduling as Record<string, unknown> | undefined)
  const labels = await MetadataModel.find({ type: 'label' }).select('externalId name').lean()
  const specialIds = [...config.iep504LabelIds, ...(config.mllLabelId ? [config.mllLabelId] : [])]
  if (!config.iep504LabelIds.length || !config.mllLabelId || specialIds.some(id => !labels.some(label => label.externalId === id))) {
    throw createError({ statusCode: 409, statusMessage: 'Configure valid IEP/504 and MLL labels in Exam Scheduling before creating rosters.' })
  }
  try {
    new RegExp(config.sessionLabelPattern, 'i')
  } catch {
    throw createError({ statusCode: 409, statusMessage: 'Correct the test-day label pattern in Exam Scheduling before creating rosters.' })
  }
  const applications = (await ApplicationModel.find({ cycleId }).select('name initialFormId').lean())
    .filter(application => ['9th grade', 'current hs'].includes(application.name.trim().replace(/\s+/g, ' ').toLowerCase()))
  const applicationIds = applications.map(application => String(application._id))
  if (!applicationIds.length) return { sessions: [], rows: [], diagnostics: ['No 9th Grade or Current HS applications found in this cycle.'], generatedAt: new Date().toISOString() }
  const [submissions, mappings, stages] = await Promise.all([
    SubmissionModel.find({ cycleId, applicationId: { $in: applicationIds }, labelIds: { $in: specialIds }, status: { $not: /^withdrawn$/i } })
      .select('submissionId submissionIdInt applicationId labelIds status reviewCompletion mappedFields.FullName mappedFields.FirstName mappedFields.LastName mappedFields.IEPor504 mappedFields.IEPorNPSPor504 mappedFields.ParentPhone')
      .lean(),
    FieldMappingModel.find({ cycleId, canonicalName: { $ne: '' } }).select('formId canonicalName').lean(),
    ReviewStageModel.find({ cycleId, applicationId: { $in: applicationIds } }).select('applicationId stageId name formId').lean()
  ])
  const ids = submissions.map(submission => submission.submissionId)
  const reviews = await ReviewModel.find({ cycleId, submissionId: { $in: ids } })
    .select('submissionId applicationId stageId stageName status completedAt createdAt mappedData.CompleteIEP mappedData.Complete504 mappedData.CompleteIEP504 mappedData.Accommodations mappedData.AccommodationsDescribe mappedData.MLLAccommodations mappedData.Language')
    .lean()
  const reviewsBySubmission = new Map<string, ExamReviewInput[]>()
  for (const review of reviews) {
    const list = reviewsBySubmission.get(review.submissionId) || []
    list.push(review)
    reviewsBySubmission.set(review.submissionId, list)
  }
  const result = buildIepRoster({ config, labels, stages, submissions: submissions as SchedulableSubmission[], reviewsBySubmission })
  const check = (formId: string | undefined, source: string, fields: string[]) => {
    const mapped = new Set(mappings.filter(mapping => mapping.formId === formId).map(mapping => mapping.canonicalName))
    const missing = fields.filter(field => !mapped.has(field))
    if (missing.length) result.diagnostics.push(`${source}: missing mappings ${missing.join(', ')}. Review Mappings and refresh mapped responses; affected values may be unknown.`)
  }
  for (const applicationId of new Set(submissions.map(submission => submission.applicationId))) {
    const app = applications.find(application => String(application._id) === applicationId)
    check(app?.initialFormId, app?.name || applicationId, ['FirstName', 'LastName', 'FullName', 'ParentPhone'])
    const appStages = stages.filter(stage => stage.applicationId === applicationId)
    for (const [pattern, fields] of [
      [/^iep\s*\/\s*504\s+completion(?:\s+review)?$/i, ['CompleteIEP504']],
      [/^iep\s+review$/i, ['CompleteIEP', 'Accommodations', 'AccommodationsDescribe']],
      [/^504\s+review$/i, ['Complete504', 'Accommodations', 'AccommodationsDescribe']],
      [/^mll\s+review$/i, ['MLLAccommodations', 'Language']]
    ] as const) {
      const matching = appStages.filter(stage => pattern.test(stage.name.trim()))
      if (!matching.length) result.diagnostics.push(`${app?.name || applicationId}: review stage ${pattern.source} is missing. Sync review stages before relying on this roster.`)
      for (const stage of matching) check(stage.formId, `${app?.name || applicationId} / ${stage.name}`, [...fields])
    }
  }
  return { ...result, generatedAt: new Date().toISOString() }
}
