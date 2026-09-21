import { HSPTResultModel } from '~~/server/models/HSPTResult'
import { SubmissionModel } from '~~/server/models/Submission'

export default defineEventHandler(async (event) => {
  await connectDb()
  await requireAuth(event)

  const {
    cycleId,
    status,
    needsReview,
    q,
    page,
    limit
  } = getQuery(event) as {
    cycleId?: string
    status?: string
    needsReview?: string
    q?: string
    page?: string
    limit?: string
  }

  if (!cycleId) {
    throw createError({ statusCode: 400, statusMessage: 'cycleId is required' })
  }

  const filter: Record<string, unknown> = { cycleId }
  if (needsReview === 'true') {
    filter.status = 'unlinked'
    filter.linkedSubmissionId = { $exists: true, $ne: null }
    filter.matchScore = { $lt: 1 }
  } else if (status) {
    filter.status = status
  }
  if (q?.trim()) {
    const pattern = new RegExp(q.trim(), 'i')
    filter.$or = [
      { firstName: pattern },
      { lastName: pattern },
      { birth: pattern },
      { optCd: pattern }
    ]
  }

  const pageNumber = Math.max(1, Number(page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(limit) || 25))

  const [results, total] = await Promise.all([
    HSPTResultModel.find(filter)
      .sort({ lastName: 1, firstName: 1 })
      .skip((pageNumber - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    HSPTResultModel.countDocuments(filter)
  ])

  const submissionIds = [...new Set(results.map(r => r.linkedSubmissionId).filter(Boolean))]
  const submissions = await SubmissionModel.find({
    submissionId: { $in: submissionIds }
  }).select('submissionId submissionIdInt mappedFields').lean()
  const submissionById = new Map(submissions.map(s => [s.submissionId, s]))

  const resultsWithSubmissions = results.map(r => ({
    ...r,
    submission: r.linkedSubmissionId ? submissionById.get(r.linkedSubmissionId) : undefined
  }))

  return {
    results: resultsWithSubmissions,
    total,
    page: pageNumber,
    limit: pageSize
  }
})
