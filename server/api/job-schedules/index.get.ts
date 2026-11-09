import { JobScheduleModel, ScheduleCycleModel, ScheduleRunModel } from '../../models/JobSchedule'
import { detroitParts, nextOccurrence, occurrenceOn } from '../../utils/scheduleTime'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  await connectDb()
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const now = new Date()
  const today = detroitParts(now).date
  const schedules = await JobScheduleModel.find().sort({ name: 1, _id: 1 }).lean()
  const holds = await ScheduleCycleModel.find({ hold: { $exists: true } }).lean()
  const occurred = new Set(await ScheduleRunModel.distinct('scheduleId', { localDate: today }))
  return { schedules: schedules.map((schedule) => {
    const due = occurrenceOn(today, schedule.time)
    const after = occurred.has(String(schedule._id)) && due > now ? due : now
    return { ...schedule, nextAt: schedule.enabled ? nextOccurrence(schedule.time, after) : null }
  }), holds }
})
