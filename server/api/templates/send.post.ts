import { ReviewModel } from '~~/server/models/Review'
import { ReviewStageModel } from '~~/server/models/ReviewStage'
import { SubmissionModel } from '~~/server/models/Submission'
import { renderMergeFields } from '~~/server/utils/routingActions'
import { buildRoutingContext, loadListOptionLabels, loadResponseLibraries } from '~~/server/utils/routingRun'
import { normalizeRoutingConfig } from '~~/server/utils/routingConfig'
import { sendSubmissionMessage } from '~~/server/utils/submittable'
import { recordDisclosure } from '~~/server/utils/disclosureAudit'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  await connectDb()
  const body = await readBody<{ submissionId?: string, subject?: string, bodyHtml?: string }>(event)
  if (!body.submissionId) throw createError({ statusCode: 400, statusMessage: 'submissionId is required' })
  if (!body.subject?.trim() || !body.bodyHtml?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'Subject and body are required to send a message' })
  }

  const submission = await SubmissionModel.findOne({ submissionId: body.submissionId }).lean()
  if (!submission) throw createError({ statusCode: 404, statusMessage: 'Submission not found' })

  const [stages, reviews, optionLabels, libraries] = await Promise.all([
    ReviewStageModel.find({ cycleId: submission.cycleId, applicationId: submission.applicationId }).lean(),
    ReviewModel.find({ cycleId: submission.cycleId, submissionId: submission.submissionId }).lean(),
    loadListOptionLabels(String(submission.cycleId)),
    loadResponseLibraries()
  ])
  const routingStages = stages.map(stage => ({
    stageId: stage.stageId,
    name: stage.name,
    order: stage.order,
    role: stage.role || 'work' as const,
    routing: normalizeRoutingConfig(stage.routing)
  }))
  const context = buildRoutingContext(submission, routingStages, reviews)

  const subject = renderMergeFields(body.subject, context, { optionLabels, libraries })
  const rendered = renderMergeFields(body.bodyHtml, context, { mode: 'html', optionLabels, libraries })
  const warnings = {
    unresolved: [...new Set([...subject.unresolved, ...rendered.unresolved])],
    unknownFormats: [...new Set([...subject.unknownFormats, ...rendered.unknownFormats])],
    unknownLibraries: [...new Set([...subject.unknownLibraries, ...rendered.unknownLibraries])]
  }

  await sendSubmissionMessage({ submissionIds: [submission.submissionId], subject: subject.text, body: rendered.text })

  await recordDisclosure({
    actor: user.email,
    action: 'applicant_message_sent',
    entityType: 'submission',
    entityId: submission.submissionId,
    detail: { subject: subject.text }
  })

  return { sent: true, subject: subject.text, ...warnings }
})
