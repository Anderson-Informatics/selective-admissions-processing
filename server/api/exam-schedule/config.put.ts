import { AuditLogModel } from '~~/server/models/AuditLog'
import { CycleModel } from '~~/server/models/Cycle'
import { configChanges, configHash } from '~~/server/utils/configAudit'
import { normalizeExamSchedulingConfig } from '~~/server/utils/examScheduling'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  await connectDb()
  const body = await readBody<{ cycleId?: string, config?: Record<string, unknown> }>(event)
  if (!body.cycleId) throw createError({ statusCode: 400, statusMessage: 'cycleId is required' })

  const cycle = await CycleModel.findById(body.cycleId)
  if (!cycle) throw createError({ statusCode: 404, statusMessage: 'Cycle not found' })

  const before = normalizeExamSchedulingConfig(cycle.examScheduling as Record<string, unknown> | undefined)
  const next = normalizeExamSchedulingConfig(body.config || {})
  // Finalized schedules are written by the finalize job only — never overwrite from the editor.
  next.schedules = before.schedules

  cycle.examScheduling = next as unknown as Record<string, unknown>
  await cycle.save()

  const changes = configChanges(before as unknown as Record<string, unknown>, next as unknown as Record<string, unknown>)
  if (changes.length) {
    await AuditLogModel.create({
      action: 'exam_scheduling_config_updated',
      actor: user.email,
      cycleId: String(cycle._id),
      entityType: 'cycle',
      entityId: String(cycle._id),
      changes,
      beforeHash: configHash(before),
      afterHash: configHash(next)
    })
  }

  return { config: next }
})
