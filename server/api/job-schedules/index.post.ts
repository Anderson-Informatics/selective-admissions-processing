import { scheduleSchema } from '../../../shared/jobSchedule'
import { JobScheduleModel } from '../../models/JobSchedule'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const parsed = scheduleSchema.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message || 'Invalid schedule' })
  if (parsed.data.revision !== 0) throw createError({ statusCode: 400, statusMessage: 'New schedules require revision zero' })
  await connectDb()
  return JobScheduleModel.create({ ...parsed.data, eligibleAfter: new Date(), createdBy: user.email, updatedBy: user.email })
})
