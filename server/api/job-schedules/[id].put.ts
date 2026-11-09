import { Types } from 'mongoose'
import { scheduleSchema } from '../../../shared/jobSchedule'
import { JobScheduleModel } from '../../models/JobSchedule'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const id = getRouterParam(event, 'id')
  if (!id || !Types.ObjectId.isValid(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid schedule ID' })
  const parsed = scheduleSchema.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message || 'Invalid schedule' })
  await connectDb()
  const existing = await JobScheduleModel.findById(id).lean()
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Schedule not found' })
  const { revision, ...settings } = parsed.data
  const reset = settings.time !== existing.time || (settings.enabled && !existing.enabled)
  const updated = await JobScheduleModel.findOneAndUpdate({ _id: id, revision }, { $set: { ...settings, updatedBy: user.email, ...(reset ? { eligibleAfter: new Date() } : {}) }, $inc: { revision: 1 } }, { returnDocument: 'after' })
  if (!updated) throw createError({ statusCode: 409, statusMessage: 'Schedule changed. Reload before saving.' })
  return updated
})
