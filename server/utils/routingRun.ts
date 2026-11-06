import { ApplicationModel } from '../models/Application'
import { FieldMappingModel } from '../models/FieldMapping'
import { GpaRecordModel } from '../models/GpaRecord'
import { MetadataModel } from '../models/Metadata'
import { ReviewModel } from '../models/Review'
import { ReviewStageModel } from '../models/ReviewStage'
import { SubmissionModel, type Submission } from '../models/Submission'
import { buildListOptionLabels } from './mergeFields'
import { normalizeRoutingConfig } from './routingConfig'
import { applicantName, routingPreviewFilter } from './routingPreview'
import { resolveSubmissionRound } from './cycleRounds'
import { computeReviewCompletion, resolveGpa, routeSubmission, type ReviewCompletionResult, type ResolvedGpa, type RoutingContext, type RoutingDecision, type RoutingStage } from './routingEvaluator'

export interface RoutingEvaluationOptions {
  cycleId: string
  applicationId?: string
  labelId?: string
  submissionIds?: string[]
  limit?: number
  maxLimit?: number
}

export interface SubmissionEvaluation {
  submission: Submission
  applicantName: string
  applicationName: string
  stages: RoutingStage[]
  context: RoutingContext
  completion: ReviewCompletionResult
  resolvedGpa: ResolvedGpa
  decision: RoutingDecision
}

export interface CycleEvaluation {
  submissions: SubmissionEvaluation[]
  applicationNames: Map<string, string>
  stageNameById: Map<string, string>
}

export function buildRoutingContext(
  submission: Submission,
  stages: RoutingStage[],
  reviews: Array<{ stageId: string, stageName?: string, status?: string, score?: number, completedAt?: Date | string, createdAt?: Date | string, mappedData?: Record<string, unknown> }>,
  gpa?: RoutingContext['gpa'],
  cycleRound?: string
): RoutingContext {
  const context: RoutingContext = {
    submission: {
      submissionId: submission.submissionId,
      mappedFields: submission.mappedFields || {},
      isMapped: submission.isMapped === true,
      labelIds: submission.labelIds || [],
      currentStageId: submission.currentStageId,
      hsptResultId: submission.hsptResultId,
      status: submission.status
    },
    reviews: reviews.map(review => ({
      stageId: review.stageId,
      stageName: stages.find(stage => stage.stageId === review.stageId)?.name || review.stageName,
      status: review.status,
      score: review.score,
      completedAt: review.completedAt,
      createdAt: review.createdAt,
      mappedData: review.mappedData || {}
    })),
    gpa,
    cycleRound
  }
  const preliminary = computeReviewCompletion(stages, { ...context, prerequisitesComplete: true })
  context.prerequisitesComplete = preliminary.reviewCompletion
    .filter(entry => (entry.role === 'work' || entry.role === 'initial') && !/ready for placement/i.test(entry.name))
    .every(entry => !entry.required || entry.complete)
  return context
}

export async function loadListOptionLabels(cycleId: string): Promise<Record<string, string[]>> {
  const mappings = await FieldMappingModel.find({ cycleId, canonicalName: { $ne: '' } }).select('formId fieldId label canonicalName').lean()
  const formIds = [...new Set(mappings.map(mapping => mapping.formId))]
  if (!formIds.length) return {}
  const forms = await MetadataModel.find({ type: 'form', externalId: { $in: formIds } }).select('externalId name data.fields').lean()
  return buildListOptionLabels(mappings, forms)
}

export async function evaluateCycleSubmissions(options: RoutingEvaluationOptions): Promise<CycleEvaluation> {
  const filter: Record<string, unknown> = routingPreviewFilter(options.cycleId, options.applicationId, options.labelId)
  if (options.submissionIds) {
    delete filter.labelIds
    filter.submissionId = { $in: options.submissionIds }
  }
  const limit = Math.max(1, Math.min(options.limit || 250, options.maxLimit || 500))
  const submissions = await SubmissionModel.find(filter).sort({ _id: 1 }).limit(limit).lean()
  const applicationIds = [...new Set(submissions.map(submission => String(submission.applicationId)))]
  const [stages, reviews, gpaRecords, applications] = await Promise.all([
    ReviewStageModel.find({ cycleId: options.cycleId, applicationId: { $in: applicationIds } }).lean(),
    ReviewModel.find({ cycleId: options.cycleId, submissionId: { $in: submissions.map(submission => submission.submissionId) } }).lean(),
    GpaRecordModel.find({ cycleId: options.cycleId, submissionId: { $in: submissions.map(submission => submission.submissionId) } }).lean(),
    ApplicationModel.find({ _id: { $in: applicationIds } }).lean()
  ])

  const stagesByApplication = new Map<string, RoutingStage[]>()
  const stageNameById = new Map<string, string>()
  for (const stage of stages) {
    stageNameById.set(stage.stageId, stage.name)
    const list = stagesByApplication.get(String(stage.applicationId)) || []
    list.push({ stageId: stage.stageId, name: stage.name, order: stage.order, role: stage.role || 'work', routing: normalizeRoutingConfig(stage.routing) })
    stagesByApplication.set(String(stage.applicationId), list)
  }
  const reviewsBySubmission = new Map<string, typeof reviews>()
  for (const review of reviews) {
    const list = reviewsBySubmission.get(review.submissionId) || []
    list.push(review)
    reviewsBySubmission.set(review.submissionId, list)
  }
  const gpaBySubmission = new Map(gpaRecords.map(record => [record.submissionId, record]))
  const applicationNames = new Map(applications.map(application => [String(application._id), application.name]))
  const roundsByApplication = new Map(applications.map(application => [String(application._id), application.rounds || []]))

  const evaluations: SubmissionEvaluation[] = []
  for (const submission of submissions) {
    const routingStages = stagesByApplication.get(String(submission.applicationId)) || []
    const submissionReviews = reviewsBySubmission.get(submission.submissionId) || []
    const round = resolveSubmissionRound(submission, roundsByApplication.get(String(submission.applicationId)) || [])
    const context = buildRoutingContext(
      submission,
      routingStages,
      submissionReviews,
      gpaBySubmission.get(submission.submissionId) as RoutingContext['gpa'],
      round.key
    )
    const completion = computeReviewCompletion(routingStages, context)
    const decision = routeSubmission(routingStages, context)

    evaluations.push({
      submission,
      applicantName: applicantName(submission.mappedFields || {}, submission.submissionId),
      applicationName: applicationNames.get(String(submission.applicationId)) || String(submission.applicationId),
      stages: routingStages,
      context,
      completion,
      resolvedGpa: resolveGpa(context),
      decision
    })
  }

  return { submissions: evaluations, applicationNames, stageNameById }
}
