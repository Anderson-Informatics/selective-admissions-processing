import { EXAM_GROUP_DEFS, formatSessionDateLong, groupLabelNames } from '~~/server/utils/examScheduling'
import { computeSessionAssignment, loadExamScheduleContext, resolveGroupLabelIds } from '~~/server/utils/examSchedulingRun'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  await connectDb()
  const body = await readBody<{ cycleId?: string, sessionLabelId?: string }>(event)
  if (!body.cycleId || !body.sessionLabelId) {
    throw createError({ statusCode: 400, statusMessage: 'cycleId and sessionLabelId are required' })
  }

  const context = await loadExamScheduleContext(body.cycleId)
  if (!context) throw createError({ statusCode: 404, statusMessage: 'Cycle not found' })
  const session = context.labels.find(label => label.externalId === body.sessionLabelId)
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Session label not found' })

  const result = await computeSessionAssignment(context, body.sessionLabelId)
  const usedGroupKeys = Object.keys(result.groups).filter(key => result.groups[key]!.length > 0)
  const { missing } = resolveGroupLabelIds(context, usedGroupKeys)

  const rows = EXAM_GROUP_DEFS
    .filter(def => (result.groups[def.key] || []).length > 0 || def.schedulable)
    .map((def) => {
      const bounds = context.config.groups[def.key] || { min: 0, max: 0 }
      const count = (result.groups[def.key] || []).length
      return {
        key: def.key,
        name: def.name,
        entrance: def.entrance,
        arrivalTime: def.arrivalTime,
        labelNames: groupLabelNames(def, context.config),
        min: def.schedulable ? bounds.min : null,
        max: def.schedulable ? bounds.max : null,
        note: bounds.note || '',
        count,
        submissionIds: result.groups[def.key] || [],
        underMin: def.schedulable === true && count < bounds.min,
        overMax: def.schedulable === true && count > bounds.max
      }
    })

  return {
    session: { labelId: session.externalId, name: session.name, date: formatSessionDateLong(session.name) },
    rows,
    assignments: result.assignments,
    diagnostics: result.diagnostics,
    missingLabels: missing,
    members: result.members,
    blockers: result.unassignedIds.map(id => result.members[id]!),
    reviewWarnings: Object.values(result.members).filter(member => member.missingRequiredReviews.length > 0),
    assignedCount: Object.keys(result.assignments).length,
    unassignedCount: result.unassignedIds.length
  }
})
