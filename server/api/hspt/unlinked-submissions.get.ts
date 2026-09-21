import { SubmissionModel } from '~~/server/models/Submission'

export default defineEventHandler(async (event) => {
  await connectDb()
  await requireAuth(event)

  const { cycleId, q = '', limit = '50' } = getQuery(event) as { cycleId?: string, q?: string, limit?: string }
  if (!cycleId) {
    throw createError({ statusCode: 400, statusMessage: 'cycleId is required' })
  }

  const search = q.trim()
  if (search.length < 2) return []

  const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(escaped, 'i')
  const conditions: Record<string, unknown>[] = [
    { 'mappedFields.FullName': pattern },
    { 'mappedFields.FirstName': pattern },
    { 'mappedFields.LastName': pattern },
    { submissionId: pattern }
  ]
  if (/^\d+$/.test(search)) conditions.push({ submissionIdInt: Number(search) })

  const submissions = await SubmissionModel.find({
    cycleId,
    status: { $ne: 'withdrawn' },
    $or: conditions
  }).select('submissionId submissionIdInt mappedFields')
    .sort({ 'mappedFields.FullName': 1 })
    .limit(Math.min(100, Math.max(1, Number(limit) || 50)))
    .lean()

  return submissions.map(s => ({
    submissionId: s.submissionId,
    submissionIdInt: s.submissionIdInt,
    fullName: String(s.mappedFields?.FullName || s.submissionId),
    firstName: String(s.mappedFields?.FirstName || ''),
    lastName: String(s.mappedFields?.LastName || '')
  }))
})
