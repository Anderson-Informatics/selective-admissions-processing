import { MessageTemplateModel } from '~~/server/models/MessageTemplate'
import { ReviewModel } from '~~/server/models/Review'
import { ReviewStageModel } from '~~/server/models/ReviewStage'
import { SubmissionModel } from '~~/server/models/Submission'
import { examSessionTokens, EXAM_GROUP_DEFS } from '~~/server/utils/examScheduling'
import { loadExamScheduleContext } from '~~/server/utils/examSchedulingRun'
import { renderMergeFields } from '~~/server/utils/routingActions'
import { buildRoutingContext, loadListOptionLabels, loadResponseLibraries } from '~~/server/utils/routingRun'
import { normalizeRoutingConfig } from '~~/server/utils/routingConfig'
import { sendSubmissionMessage } from '~~/server/utils/submittable'
import { recordDisclosure } from '~~/server/utils/disclosureAudit'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  await connectDb()
  const body = await readBody<{ cycleId?: string, sessionLabelId?: string, groupKey?: string }>(event)
  if (!body.cycleId || !body.sessionLabelId || !body.groupKey) {
    throw createError({ statusCode: 400, statusMessage: 'cycleId, sessionLabelId, and groupKey are required' })
  }

  const context = await loadExamScheduleContext(body.cycleId)
  if (!context) throw createError({ statusCode: 404, statusMessage: 'Cycle not found' })
  const { config } = context
  if (!config.messageTemplateId) throw createError({ statusCode: 400, statusMessage: 'No message template configured' })

  const group = EXAM_GROUP_DEFS.find(def => def.key === body.groupKey)
  if (!group) throw createError({ statusCode: 400, statusMessage: `Unknown group key: ${body.groupKey}` })
  const session = context.labels.find(label => label.externalId === body.sessionLabelId)
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Session label not found' })

  const [template, submission] = await Promise.all([
    MessageTemplateModel.findById(config.messageTemplateId).lean(),
    SubmissionModel.findOne({ submissionId: config.testSubmissionId }).lean()
  ])
  if (!template) throw createError({ statusCode: 404, statusMessage: 'Configured message template not found' })
  if (!submission) throw createError({ statusCode: 404, statusMessage: `Test submission ${config.testSubmissionId} not found` })

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
  const routingContext = buildRoutingContext(submission, routingStages, reviews)
  routingContext.examSession = { ...examSessionTokens(group.key, session.name, config) }

  const subject = renderMergeFields(template.subject, routingContext, { optionLabels, libraries })
  const rendered = renderMergeFields(template.bodyHtml, routingContext, { mode: 'html', optionLabels, libraries })
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
    detail: { subject: subject.text, examScheduleTest: { sessionLabelId: body.sessionLabelId, groupKey: group.key } }
  })

  return { sent: true, subject: subject.text, ...warnings }
})
