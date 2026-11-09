import { Types } from 'mongoose'
import { ScheduleRunModel } from '../../../models/JobSchedule'
import { JobModel } from '../../../models/Job'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  await connectDb()
  const id = getRouterParam(event, 'id')
  if (!id || !Types.ObjectId.isValid(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid run ID' })
  const run = await ScheduleRunModel.findById(id).lean()
  if (!run) throw createError({ statusCode: 404, statusMessage: 'Run not found' })
  const jobs = await JobModel.find({ scheduleRunId: id }).sort({ scheduleStep: 1, createdAt: 1 }).lean()
  return { run, jobs }
})
