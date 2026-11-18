import { JobModel } from '~~/server/models/Job'

export default defineEventHandler(async (event) => {
  await connectDb()
  await requireAuth(event)

  const { cycleId } = getQuery(event) as Record<string, string>
  if (!cycleId) throw createError({ statusCode: 400, statusMessage: 'cycleId is required' })

  return JobModel.findOne({ cycleId, type: 'dpscd_gpa_import', parentJobId: { $exists: false } })
    .sort({ createdAt: -1, _id: -1 })
    .select('status createdAt result.matched result.unmatched result.updated')
    .lean()
})
