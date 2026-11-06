import { ReviewModel } from '~~/server/models/Review'
import { ReviewStageModel } from '~~/server/models/ReviewStage'
import { SubmissionModel } from '~~/server/models/Submission'
import { renderMergeFields } from '~~/server/utils/routingActions'
import { buildRoutingContext, loadListOptionLabels } from '~~/server/utils/routingRun'
import { normalizeRoutingConfig } from '~~/server/utils/routingConfig'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  await connectDb()
  const body = await readBody<{ submissionId?: string, subject?: string, bodyHtml?: string }>(event)
  if (!body.submissionId) throw createError({ statusCode: 400, statusMessage: 'submissionId is required' })

  const submission = await SubmissionModel.findOne({ submissionId: body.submissionId }).lean()
  if (!submission) throw createError({ statusCode: 404, statusMessage: 'Submission not found' })

  const [stages, reviews, optionLabels] = await Promise.all([
    ReviewStageModel.find({ cycleId: submission.cycleId, applicationId: submission.applicationId }).lean(),
    ReviewModel.find({ cycleId: submission.cycleId, submissionId: submission.submissionId }).lean(),
    loadListOptionLabels(String(submission.cycleId))
  ])
  const routingStages = stages.map(stage => ({
    stageId: stage.stageId,
    name: stage.name,
    order: stage.order,
    role: stage.role || 'work' as const,
    routing: normalizeRoutingConfig(stage.routing)
  }))
  const context = buildRoutingContext(submission, routingStages, reviews)

  const subject = renderMergeFields(typeof body.subject === 'string' ? body.subject : '', context, { optionLabels })
  const rendered = renderMergeFields(typeof body.bodyHtml === 'string' ? body.bodyHtml : '', context, { mode: 'html', optionLabels })
  return {
    subject: subject.text,
    bodyHtml: rendered.text,
    unresolved: [...new Set([...subject.unresolved, ...rendered.unresolved])],
    unknownFormats: [...new Set([...subject.unknownFormats, ...rendered.unknownFormats])]
  }
})
