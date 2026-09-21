import { JobModel } from '../../models/Job'

export default defineEventHandler(async (event) => {
  await connectDb()
  await requireAuth(event)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const { cycleId } = getQuery(event) as { cycleId?: string }
  const filter: any = { parentJobId: { $exists: false } }
  if (cycleId) filter.cycleId = cycleId

  return JobModel.find(filter)
    .sort({ createdAt: -1 })
    .limit(50)
    .select('_id status progress result error startedAt completedAt updatedAt')
    .lean()
})
