import { ReviewModel } from '~~/server/models/Review'
import { SubmissionModel } from '~~/server/models/Submission'

export default defineEventHandler(async (event) => {
  await connectDb()
  await requireAuth(event)

  const { cycleId, applicationId, q, page = '1', limit = '25' } = getQuery(event) as Record<string, string>

  if (!cycleId) {
    throw createError({ statusCode: 400, statusMessage: 'cycleId is required' })
  }

  const filter: Record<string, unknown> = { cycleId }
  if (applicationId) {
    filter.applicationId = applicationId
  }
  if (q?.trim()) {
    filter.$or = [
      { submissionId: { $regex: q, $options: 'i' } },
      { 'mappedFields.FullName': { $regex: q, $options: 'i' } },
      { 'mappedFields.FirstName': { $regex: q, $options: 'i' } },
      { 'mappedFields.LastName': { $regex: q, $options: 'i' } },
      { 'mappedFields.Email': { $regex: q, $options: 'i' } }
    ]
  }

  const pageNum = Math.max(1, parseInt(page, 10) || 1)
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 25))
  const skip = (pageNum - 1) * limitNum

  const [submissions, total] = await Promise.all([
    SubmissionModel.find(filter)
      .select('submissionId applicationId status completedAt createdBy mappedFields entryIds currentStageName geocode catchment labelIds')
      .sort({ completedAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
    SubmissionModel.countDocuments(filter)
  ])

  const submissionIds = submissions.map(s => s.submissionId)
  const reviewCounts = submissionIds.length
    ? await ReviewModel.aggregate([
        { $match: { cycleId, submissionId: { $in: submissionIds }, status: 'complete' } },
        { $group: { _id: '$submissionId', count: { $sum: 1 } } }
      ])
    : []

  const completedReviewCountById = Object.fromEntries(reviewCounts.map(r => [r._id, r.count]))

  return {
    submissions: submissions.map(sub => ({
      ...sub,
      completedReviewCount: completedReviewCountById[sub.submissionId] || 0
    })),
    total,
    page: pageNum,
    limit: limitNum
  }
})
