import { evaluateCycleSubmissions } from '../../utils/routingRun'

interface PreviewBody {
  cycleId?: string
  applicationId?: string
  labelId?: string
  limit?: number
}

export default defineEventHandler(async (event) => {
  await connectDb()
  await requireAuth(event)
  const body = await readBody<PreviewBody>(event)
  if (!body.cycleId) throw createError({ statusCode: 400, statusMessage: 'cycleId is required' })
  if (body.labelId != null && typeof body.labelId !== 'string') throw createError({ statusCode: 400, statusMessage: 'labelId must be a string' })

  const limit = Math.max(1, Math.min(body.limit || 250, 500))
  const evaluation = await evaluateCycleSubmissions({
    cycleId: body.cycleId,
    applicationId: body.applicationId,
    labelId: body.labelId,
    limit
  })

  const proposedMoves: Array<Record<string, unknown>> = []
  const submissionDetails: Array<Record<string, unknown>> = []
  const diagnostics: Array<Record<string, unknown>> = []
  let noAction = 0

  for (const item of evaluation.submissions) {
    const current = item.stages.find(stage => stage.stageId === item.decision.fromStageId)
    const target = item.stages.find(stage => stage.stageId === item.decision.toStageId)
    noAction += item.decision.action === 'stay' ? 1 : 0
    diagnostics.push(...item.decision.diagnostics.map(diagnostic => ({ submissionId: item.submission.submissionId, ...diagnostic })))
    submissionDetails.push({
      submissionId: item.submission.submissionId,
      applicantName: item.applicantName,
      applicationName: item.applicationName,
      currentStage: current?.name || item.submission.currentStageName || 'Unknown',
      proposedStage: target?.name || item.decision.toStageId || null,
      decision: item.decision.reason,
      backward: item.decision.backward,
      diagnostics: item.decision.diagnostics,
      reviewCompletion: item.completion.reviewCompletion
    })
    if (item.decision.action === 'move') {
      proposedMoves.push({
        submissionId: item.submission.submissionId,
        applicantName: item.applicantName,
        applicationId: String(item.submission.applicationId),
        applicationName: item.applicationName,
        currentStage: current?.name || item.submission.currentStageName || 'Unknown',
        proposedStage: target?.name || item.decision.toStageId,
        reason: item.decision.reason,
        backward: item.decision.backward,
        diagnostics: item.completion.diagnostics
      })
    }
  }

  const byTargetStage = proposedMoves.reduce<Record<string, number>>((counts, move) => {
    const key = String(move.proposedStage)
    counts[key] = (counts[key] || 0) + 1
    return counts
  }, {})
  return { evaluated: evaluation.submissions.length, proposedMoves, submissionDetails, noAction, diagnostics, byTargetStage, limit }
})
