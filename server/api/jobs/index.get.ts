import { JobModel } from '~~/server/models/Job'

export default defineEventHandler(async (event) => {
  await connectDb()
  await requireAuth(event)

  const { cycleId } = getQuery(event) as { cycleId?: string }
  const filter: any = { parentJobId: { $exists: false } }
  if (cycleId) filter.cycleId = cycleId

  return JobModel.find(filter).sort({ createdAt: -1 }).limit(50).lean()
})
