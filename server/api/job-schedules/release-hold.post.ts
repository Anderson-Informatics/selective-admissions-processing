import { z } from 'zod'
import { ScheduleCycleModel } from '../../models/JobSchedule'
import { AuditLogModel } from '../../models/AuditLog'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const parsed = z.object({ cycleId: z.string().regex(/^[a-f\d]{24}$/i), hold: z.string().min(1), acknowledged: z.literal(true) }).strict().safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Acknowledge review of the held run before releasing' })
  await connectDb()
  await AuditLogModel.create({ action: 'schedule_hold_release_requested', actor: user.email, cycleId: parsed.data.cycleId, entityType: 'ScheduleCycle', entityId: parsed.data.cycleId, changes: [{ path: 'hold', before: parsed.data.hold }] })
  const released = await ScheduleCycleModel.findOneAndUpdate({ cycleId: parsed.data.cycleId, hold: parsed.data.hold }, { $unset: { hold: 1, runId: 1 }, $set: { releasedBy: user.email, releasedAt: new Date() } }, { returnDocument: 'after' })
  if (!released) throw createError({ statusCode: 409, statusMessage: 'Hold changed. Reload before releasing.' })
  return released
})
