import { Types } from 'mongoose'
import { ScheduleRunModel } from '../../models/JobSchedule'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  await connectDb()
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const query = getQuery(event)
  const page = Number(query.page || 1)
  if (!Number.isInteger(page) || page < 1 || page > 10000) throw createError({ statusCode: 400, statusMessage: 'Invalid page' })
  if (query.scheduleId && (typeof query.scheduleId !== 'string' || !Types.ObjectId.isValid(query.scheduleId))) throw createError({ statusCode: 400, statusMessage: 'Invalid schedule ID' })
  const filter = query.scheduleId ? { scheduleId: String(query.scheduleId) } : {}
  const [runs, total] = await Promise.all([ScheduleRunModel.find(filter).sort({ dueAt: -1, _id: -1 }).skip((page - 1) * 25).limit(25).lean(), ScheduleRunModel.countDocuments(filter)])
  const queued = await ScheduleRunModel.find({ status: { $in: ['queued', 'running'] } }).sort({ dueAt: 1, scheduleId: 1, _id: 1 }).limit(100).lean()
  return { runs, total, queued }
})
