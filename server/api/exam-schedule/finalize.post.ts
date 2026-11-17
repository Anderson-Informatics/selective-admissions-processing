import { computeSessionAssignment, loadExamScheduleContext, resolveGroupLabelIds } from '~~/server/utils/examSchedulingRun'
import { createJob } from '~~/server/utils/jobs'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  await connectDb()
  const body = await readBody<{ cycleId?: string, sessionLabelId?: string }>(event)
  if (!body.cycleId || !body.sessionLabelId) {
    throw createError({ statusCode: 400, statusMessage: 'cycleId and sessionLabelId are required' })
  }

  const context = await loadExamScheduleContext(body.cycleId)
  if (!context) throw createError({ statusCode: 404, statusMessage: 'Cycle not found' })
  if (!context.config.messageTemplateId) {
    throw createError({ statusCode: 400, statusMessage: 'Configure a message template before finalizing' })
  }
  const session = context.labels.find(label => label.externalId === body.sessionLabelId)
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Session label not found' })

  const result = await computeSessionAssignment(context, body.sessionLabelId)
  const usedGroupKeys = Object.keys(result.groups).filter(key => result.groups[key]!.length > 0)
  const { missing } = resolveGroupLabelIds(context, usedGroupKeys)
  if (missing.length) {
    throw createError({
      statusCode: 400,
      statusMessage: `Missing Submittable labels: ${missing.join(', ')}. Create them in Submittable and run metadata sync first.`
    })
  }

  const job = await createJob('exam_schedule_finalize', body.cycleId, user.email, {
    sessionLabelId: body.sessionLabelId,
    sessionName: session.name,
    templateId: context.config.messageTemplateId,
    assignments: result.assignments,
    groupCounts: Object.fromEntries(Object.entries(result.groups).map(([key, ids]) => [key, ids.length])),
    diagnostics: result.diagnostics
  })

  return { jobId: String(job._id), assigned: Object.keys(result.assignments).length }
})
