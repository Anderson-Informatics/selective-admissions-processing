import { Types } from 'mongoose'
import { CycleModel } from '../../../models/Cycle'
import { JobScheduleModel, ScheduleRunModel } from '../../../models/JobSchedule'
import { reconcileCycle } from '../../../utils/jobScheduler'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const id = getRouterParam(event, 'id')
  if (!id || !Types.ObjectId.isValid(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid schedule ID' })
  await connectDb()
  const schedule = await JobScheduleModel.findById(id).lean()
  if (!schedule) throw createError({ statusCode: 404, statusMessage: 'Schedule not found' })
  const cycles = await CycleModel.find({ active: true }).select('_id').limit(2).lean()
  if (cycles.length !== 1) throw createError({ statusCode: 409, statusMessage: 'Exactly one active cycle is required' })
  const now = new Date()
  let run
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      run = await ScheduleRunModel.create({
        scheduleId: id, name: schedule.name, revision: schedule.revision,
        localDate: `manual:${now.toISOString()}${attempt ? `:${attempt}` : ''}`,
        dueAt: now, cycleId: String(cycles[0]!._id), status: 'queued',
        steps: schedule.steps, dryRun: schedule.dryRun, actor: user.email,
        stepIndex: 0, partial: false
      })
      break
    } catch (error) {
      if ((error as { code?: number }).code !== 11000 || attempt === 2) throw error
    }
  }
  await reconcileCycle(String(cycles[0]!._id), now)
  return run
})
