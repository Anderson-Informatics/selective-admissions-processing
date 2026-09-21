import { ApplicationModel } from '../../models/Application'
import { CycleModel } from '../../models/Cycle'
import { GpaRecordModel } from '../../models/GpaRecord'
import { ReviewModel } from '../../models/Review'
import { ReviewStageModel } from '../../models/ReviewStage'
import { SubmissionModel } from '../../models/Submission'
import { normalizeRoutingConfig } from '../../utils/routingConfig'
import { resolveCycleRound } from '../../utils/cycleRounds'
import { computeReviewCompletion, routeSubmission, type RoutingContext, type RoutingStage } from '../../utils/routingEvaluator'

interface PreviewBody {
  cycleId?: string
  applicationId?: string
  limit?: number
}

export default defineEventHandler(async (event) => {
  await connectDb()
  await requireAuth(event)
  const body = await readBody<PreviewBody>(event)
  if (!body.cycleId) throw createError({ statusCode: 400, statusMessage: 'cycleId is required' })

  const filter: Record<string, unknown> = { cycleId: body.cycleId }
  if (body.applicationId) filter.applicationId = body.applicationId
  const limit = Math.max(1, Math.min(body.limit || 250, 500))
  const cycle = await CycleModel.findById(body.cycleId).lean()
  const rounds = cycle?.rounds || []
  const submissions = await SubmissionModel.find(filter).sort({ _id: 1 }).limit(limit).lean()
  const applicationIds = [...new Set(submissions.map(submission => String(submission.applicationId)))]
  const [stages, reviews, gpaRecords] = await Promise.all([
    ReviewStageModel.find({ cycleId: body.cycleId, applicationId: { $in: applicationIds } }).lean(),
    ReviewModel.find({ cycleId: body.cycleId, submissionId: { $in: submissions.map(submission => submission.submissionId) } }).lean(),
    GpaRecordModel.find({ cycleId: body.cycleId, submissionId: { $in: submissions.map(submission => submission.submissionId) } }).lean()
  ])

  const stagesByApplication = new Map<string, RoutingStage[]>()
  for (const stage of stages) {
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
  const applicationNames = new Map((await ApplicationModel.find({ _id: { $in: applicationIds } }).lean()).map(application => [String(application._id), application.name]))
  const proposedMoves: Array<Record<string, unknown>> = []
  const submissionDetails: Array<Record<string, unknown>> = []
  const diagnostics: Array<Record<string, unknown>> = []
  let noAction = 0

  for (const submission of submissions) {
    const routingStages = stagesByApplication.get(String(submission.applicationId)) || []
    const submissionReviews = reviewsBySubmission.get(submission.submissionId) || []
    const mappedFields = submission.mappedFields || {}
    const submissionDate = mappedFields.submissionDate || mappedFields.SubmissionDate || submission.submissionDate
    const round = resolveCycleRound(submissionDate, rounds)
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
      reviews: submissionReviews.map(review => ({ stageId: review.stageId, status: review.status, score: review.score, completedAt: review.completedAt, createdAt: review.createdAt, mappedData: review.mappedData || {} })),
      gpa: gpaBySubmission.get(submission.submissionId) as RoutingContext['gpa'],
      cycleRound: round.key
    }
    const preliminary = computeReviewCompletion(routingStages, { ...context, prerequisitesComplete: true })
    context.prerequisitesComplete = preliminary.reviewCompletion
      .filter(entry => (entry.role === 'work' || entry.role === 'initial') && !/ready for placement/i.test(entry.name))
      .every(entry => !entry.required || entry.complete)
    const completion = computeReviewCompletion(routingStages, context)
    const decision = routeSubmission(routingStages, context)
    const current = routingStages.find(stage => stage.stageId === decision.fromStageId)
    const target = routingStages.find(stage => stage.stageId === decision.toStageId)
    noAction += decision.action === 'stay' ? 1 : 0
    diagnostics.push(...decision.diagnostics.map(diagnostic => ({ submissionId: submission.submissionId, ...diagnostic })))
    submissionDetails.push({
      submissionId: submission.submissionId,
      applicationName: applicationNames.get(String(submission.applicationId)) || String(submission.applicationId),
      currentStage: current?.name || submission.currentStageName || 'Unknown',
      proposedStage: target?.name || decision.toStageId || null,
      decision: decision.reason,
      backward: decision.backward,
      diagnostics: decision.diagnostics,
      reviewCompletion: completion.reviewCompletion
    })
    if (decision.action === 'move') {
      proposedMoves.push({
        submissionId: submission.submissionId,
        applicationId: String(submission.applicationId),
        applicationName: applicationNames.get(String(submission.applicationId)) || String(submission.applicationId),
        currentStage: current?.name || submission.currentStageName || 'Unknown',
        proposedStage: target?.name || decision.toStageId,
        reason: decision.reason,
        backward: decision.backward,
        diagnostics: completion.diagnostics
      })
    }
  }

  const byTargetStage = proposedMoves.reduce<Record<string, number>>((counts, move) => {
    const key = String(move.proposedStage)
    counts[key] = (counts[key] || 0) + 1
    return counts
  }, {})
  return { evaluated: submissions.length, proposedMoves, submissionDetails, noAction, diagnostics, byTargetStage, limit }
})
