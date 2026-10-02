import { ApplicationModel } from '~~/server/models/Application'
import { JobModel } from '~~/server/models/Job'
import { ReviewModel } from '~~/server/models/Review'
import { ReviewStageModel } from '~~/server/models/ReviewStage'
import { SubmissionModel } from '~~/server/models/Submission'
import { ValidationIssueModel } from '~~/server/models/ValidationIssue'
import { resolveDashboardHighlights, type DashboardMetricSpec } from '~~/server/utils/dashboardConfig'

interface MetricResult {
  completed: number
  total: number
  percent: number | null
}

interface StageStat {
  required: number
  completed: number
}

interface MetricContext {
  totalsByApplication: Map<string, number>
  stageStats: Map<string, StageStat>
  gpaStatusCounts: Map<string, number>
  gpaRecordCounts: Map<string, { dpscd: number, optIn: number }>
  hsptLinkedCounts: Map<string, number>
  mappedFieldCounts: Map<string, number>
}

function percentOf(completed: number, total: number): number | null {
  return total ? Math.round((completed / total) * 100) : null
}

function evaluateMetric(spec: DashboardMetricSpec, applicationId: string, context: MetricContext): MetricResult {
  let completed = 0
  let total = 0
  switch (spec.type) {
    case 'reviewStage': {
      const stat = context.stageStats.get(`${applicationId}:${spec.stageId}`)
      completed = stat?.completed || 0
      total = stat?.required || 0
      break
    }
    case 'gpaStatus':
      completed = context.gpaStatusCounts.get(`${applicationId}:${spec.status}`) || 0
      total = context.totalsByApplication.get(applicationId) || 0
      break
    case 'gpaRecord': {
      const counts = context.gpaRecordCounts.get(applicationId)
      completed = (spec.source === 'dpscd' ? counts?.dpscd : counts?.optIn) || 0
      total = context.totalsByApplication.get(applicationId) || 0
      break
    }
    case 'hsptLinked':
      completed = context.hsptLinkedCounts.get(applicationId) || 0
      total = context.totalsByApplication.get(applicationId) || 0
      break
    case 'mappedField':
      completed = context.mappedFieldCounts.get(`${applicationId}:${JSON.stringify(spec)}`) || 0
      total = context.totalsByApplication.get(applicationId) || 0
      break
  }
  return { completed, total, percent: percentOf(completed, total) }
}

function mappedFieldFilter(spec: Extract<DashboardMetricSpec, { type: 'mappedField' }>): Record<string, unknown> {
  const path = `mappedFields.${spec.field}`
  switch (spec.op || 'eq') {
    case 'ne': return { [path]: { $ne: spec.value } }
    case 'in': return { [path]: { $in: Array.isArray(spec.value) ? spec.value : [spec.value] } }
    case 'nin': return { [path]: { $nin: Array.isArray(spec.value) ? spec.value : [spec.value] } }
    case 'isNull': return { [path]: null }
    case 'notNull': return { [path]: { $ne: null } }
    default: return { [path]: spec.value }
  }
}

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
    reviewStages,
    totalSubmissions,
    mappedSubmissions,
    completedSubmissions,
    applicationCounts,
    reviewStageCounts,
    statusCounts,
    ledgerStageStats,
    applicationMetrics,
    gpaStatusCountsRaw,
    totalReviews,
    completedReviews,
    jobCounts,
    recentJobs
  ] = await Promise.all([
    ApplicationModel.find({ cycleId }).select('name type active dashboard').sort({ name: 1 }).lean(),
    ReviewStageModel.find({ cycleId }).select('applicationId stageId name role').lean(),
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
      { $unwind: '$reviewCompletion' },
      { $match: { 'reviewCompletion.role': { $ne: 'final' } } },
      {
        $group: {
          _id: { applicationId: '$applicationId', stageId: '$reviewCompletion.stageId' },
          name: { $first: '$reviewCompletion.name' },
          order: { $first: '$reviewCompletion.order' },
          role: { $first: '$reviewCompletion.role' },
          required: { $sum: { $cond: ['$reviewCompletion.required', 1, 0] } },
          completed: { $sum: { $cond: [{ $and: ['$reviewCompletion.required', '$reviewCompletion.complete'] }, 1, 0] } }
        }
      },
      { $match: { required: { $gt: 0 } } }
    ]),
    SubmissionModel.aggregate([
      { $match: submissionFilter },
      {
        $group: {
          _id: '$applicationId',
          total: { $sum: 1 },
          gpaDpscd: { $sum: { $cond: ['$gpaDpscd', 1, 0] } },
          gpaOptIn: { $sum: { $cond: ['$gpaOptIn', 1, 0] } },
          hsptLinked: {
            $sum: {
              $cond: [
                { $and: [{ $ne: ['$hsptResultId', null] }, { $ne: ['$hsptResultId', ''] }] },
                1,
                0
              ]
            }
          }
        }
      }
    ]),
    SubmissionModel.aggregate([
      { $match: submissionFilter },
      { $group: { _id: { applicationId: '$applicationId', gpaStatus: { $ifNull: ['$gpaStatus', ''] } }, total: { $sum: 1 } } }
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
  const stagesByApplication = new Map<string, typeof reviewStages>()
  for (const stage of reviewStages) {
    const list = stagesByApplication.get(String(stage.applicationId)) || []
    list.push(stage)
    stagesByApplication.set(String(stage.applicationId), list)
  }

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

  const stageStats = new Map<string, StageStat>()
  const ledgerByApplication = new Map<string, { stageId: string, name: string, order: number, role: string, required: number, completed: number, percent: number | null }[]>()
  for (const item of ledgerStageStats) {
    const applicationId = String(item._id.applicationId)
    const stageId = String(item._id.stageId)
    stageStats.set(`${applicationId}:${stageId}`, { required: item.required, completed: item.completed })
    const list = ledgerByApplication.get(applicationId) || []
    list.push({
      stageId,
      name: item.name,
      order: item.order,
      role: item.role,
      required: item.required,
      completed: item.completed,
      percent: percentOf(item.completed, item.required)
    })
    ledgerByApplication.set(applicationId, list)
  }
  for (const stages of ledgerByApplication.values()) {
    stages.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
  }

  const totalsByApplication = new Map<string, number>()
  const gpaRecordCounts = new Map<string, { dpscd: number, optIn: number }>()
  const hsptLinkedCounts = new Map<string, number>()
  for (const item of applicationMetrics) {
    const applicationId = String(item._id)
    totalsByApplication.set(applicationId, item.total)
    gpaRecordCounts.set(applicationId, { dpscd: item.gpaDpscd, optIn: item.gpaOptIn })
    hsptLinkedCounts.set(applicationId, item.hsptLinked)
  }

  const gpaStatusCounts = new Map<string, number>()
  for (const item of gpaStatusCountsRaw) {
    gpaStatusCounts.set(`${item._id.applicationId}:${item._id.gpaStatus}`, item.total)
  }

  const resolvedHighlights = new Map(applications.map(application => [
    String(application._id),
    resolveDashboardHighlights(
      { type: application.type, dashboard: application.dashboard },
      stagesByApplication.get(String(application._id)) || []
    )
  ]))

  const mappedFieldSpecs: { applicationId: string, spec: Extract<DashboardMetricSpec, { type: 'mappedField' }> }[] = []
  for (const [applicationId, highlights] of resolvedHighlights) {
    const specs = [highlights.map(h => h.metric), highlights.flatMap(h => (h.segments || []).map(s => s.metric))].flat()
    for (const spec of specs) {
      if (spec.type === 'mappedField') mappedFieldSpecs.push({ applicationId, spec })
    }
  }
  const mappedFieldCounts = new Map<string, number>()
  await Promise.all(mappedFieldSpecs.map(async ({ applicationId, spec }) => {
    const count = await SubmissionModel.countDocuments({ ...submissionFilter, applicationId, ...mappedFieldFilter(spec) })
    mappedFieldCounts.set(`${applicationId}:${JSON.stringify(spec)}`, count)
  }))

  const metricContext: MetricContext = {
    totalsByApplication,
    stageStats,
    gpaStatusCounts,
    gpaRecordCounts,
    hsptLinkedCounts,
    mappedFieldCounts
  }

  const dashboardApplications = applications.map((application) => {
    const applicationId = String(application._id)
    const highlights = (resolvedHighlights.get(applicationId) || []).map(highlight => ({
      key: highlight.key,
      label: highlight.label,
      ...evaluateMetric(highlight.metric, applicationId, metricContext),
      segments: (highlight.segments || []).map(segment => ({
        key: segment.key,
        label: segment.label,
        ...evaluateMetric(segment.metric, applicationId, metricContext)
      }))
    }))
    return {
      applicationId,
      name: application.name,
      type: application.type,
      total: totalsByApplication.get(applicationId) || 0,
      highlights,
      stages: ledgerByApplication.get(applicationId) || []
    }
  }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))

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
    applications: dashboardApplications,
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
