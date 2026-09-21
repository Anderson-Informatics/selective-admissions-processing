import { ApplicationModel } from '~~/server/models/Application'
import { JobModel } from '~~/server/models/Job'
import { ReviewModel } from '~~/server/models/Review'
import { SubmissionModel } from '~~/server/models/Submission'
import { ValidationIssueModel } from '~~/server/models/ValidationIssue'

export default defineEventHandler(async (event) => {
  await connectDb()
  await requireAuth(event)

  const { cycleId } = getQuery(event) as { cycleId?: string }
  if (!cycleId) {
    throw createError({ statusCode: 400, statusMessage: 'cycleId is required' })
  }

  const submissionFilter = { cycleId }
  const jobFilter = { cycleId, parentJobId: { $exists: false } }
  const [
    applications,
    totalSubmissions,
    mappedSubmissions,
    completedSubmissions,
    applicationCounts,
    reviewStageCounts,
    statusCounts,
    submissionStageCounts,
    totalReviews,
    completedReviews,
    jobCounts,
    recentJobs
  ] = await Promise.all([
    ApplicationModel.find({ cycleId }).select('name type active').sort({ name: 1 }).lean(),
    SubmissionModel.countDocuments(submissionFilter),
    SubmissionModel.countDocuments({ ...submissionFilter, isMapped: true }),
    SubmissionModel.countDocuments({ ...submissionFilter, completedAt: { $exists: true } }),
    SubmissionModel.aggregate([
      { $match: submissionFilter },
      {
        $group: {
          _id: '$applicationId',
          total: { $sum: 1 },
          mapped: { $sum: { $cond: ['$isMapped', 1, 0] } },
          completed: { $sum: { $cond: [{ $ne: [{ $type: '$completedAt' }, 'missing'] }, 1, 0] } }
        }
      }
    ]),
    ReviewModel.aggregate([
      { $match: { cycleId } },
      {
        $group: {
          _id: '$stageName',
          total: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'complete'] }, 1, 0] } }
        }
      },
      { $sort: { total: -1, _id: 1 } },
      { $limit: 20 }
    ]),
    SubmissionModel.aggregate([
      { $match: submissionFilter },
      { $group: { _id: { $ifNull: ['$status', 'Unknown'] }, total: { $sum: 1 } } },
      { $sort: { total: -1, _id: 1 } }
    ]),
    SubmissionModel.aggregate([
      { $match: submissionFilter },
      {
        $group: {
          _id: { applicationId: '$applicationId', currentStageId: '$currentStageId', currentStageName: '$currentStageName' },
          count: { $sum: 1 }
        }
      }
    ]),
    ReviewModel.countDocuments({ cycleId }),
    ReviewModel.countDocuments({ cycleId, status: 'complete' }),
    JobModel.aggregate([
      { $match: jobFilter },
      { $group: { _id: '$status', total: { $sum: 1 } } }
    ]),
    JobModel.find(jobFilter)
      .select('type status progress result error startedAt completedAt createdAt')
      .sort({ createdAt: -1 })
      .limit(8)
      .lean()
  ])

  const applicationsById = new Map(applications.map(application => [String(application._id), application]))
  const byApplication = applicationCounts.map((item) => {
    const application = applicationsById.get(item._id)
    return {
      applicationId: item._id,
      name: application?.name || 'Unknown application',
      type: application?.type || 'unknown',
      total: item.total,
      mapped: item.mapped,
      completed: item.completed
    }
  }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))

  const applicationStageMap = new Map<string, { applicationId: string, name: string, total: number, stages: { stageName: string, currentStageId?: string, count: number }[] }>()
  for (const application of applications) {
    applicationStageMap.set(String(application._id), {
      applicationId: String(application._id),
      name: application.name,
      total: 0,
      stages: []
    })
  }
  for (const item of submissionStageCounts) {
    const application = applicationStageMap.get(item._id.applicationId)
    if (!application) continue
    application.total += item.count
    const stageName = item._id.currentStageName || (item._id.currentStageId ? 'Unknown stage' : 'Not started')
    application.stages.push({ stageName, currentStageId: item._id.currentStageId, count: item.count })
  }
  for (const application of applicationStageMap.values()) {
    application.stages.sort((a, b) => b.count - a.count || a.stageName.localeCompare(b.stageName))
  }
  const byApplicationStage = [...applicationStageMap.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))

  const [openIssues, issuesBySeverity] = await Promise.all([
    ValidationIssueModel.countDocuments({ cycleId, status: 'open' }),
    ValidationIssueModel.aggregate([
      { $match: { cycleId, status: 'open' } },
      { $group: { _id: '$severity', total: { $sum: 1 } } }
    ])
  ])

  return {
    totals: {
      applications: applications.filter(application => application.active).length,
      submissions: totalSubmissions,
      mapped: mappedSubmissions,
      completed: completedSubmissions,
      totalReviews,
      completedReviews,
      jobs: jobCounts.reduce((sum, item) => sum + item.total, 0),
      activeJobs: jobCounts
        .filter(item => ['pending', 'waiting', 'running'].includes(item._id))
        .reduce((sum, item) => sum + item.total, 0),
      openIssues
    },
    byApplication,
    byApplicationStage,
    byReviewStage: reviewStageCounts.map(item => ({
      name: item._id || 'Unknown stage',
      total: item.total,
      completed: item.completed,
      percent: item.total ? Math.round((item.completed / item.total) * 100) : 0
    })),
    byStatus: statusCounts.map(item => ({ name: item._id || 'Unknown', total: item.total })),
    bySeverity: issuesBySeverity.map(item => ({ name: item._id || 'Unknown', total: item.total })).sort((a, b) => b.total - a.total),
    recentJobs
  }
})
