import type { FilterQuery } from 'mongoose'
import { SubmissionModel } from '~~/server/models/Submission'
import { ValidationIssueModel, type ValidationIssue } from '~~/server/models/ValidationIssue'

export default defineEventHandler(async (event) => {
  await connectDb()
  await requireAuth(event)

  const {
    cycleId,
    applicationId,
    severity,
    status,
    type,
    q,
    page,
    limit
  } = getQuery(event) as {
    cycleId?: string
    applicationId?: string
    severity?: string
    status?: string
    type?: string
    q?: string
    page?: string
    limit?: string
  }

  if (!cycleId) {
    throw createError({ statusCode: 400, statusMessage: 'cycleId is required' })
  }

  const filter: FilterQuery<ValidationIssue> = { cycleId }
  if (applicationId) filter.applicationId = applicationId
  if (severity) filter.severity = severity
  if (status) filter.status = status
  if (type) filter.type = type
  if (q?.trim()) {
    const pattern = new RegExp(q.trim(), 'i')
    const matchingSubmissions = await SubmissionModel.find({
      cycleId,
      'mappedFields.FullName': pattern
    }).select('submissionId').lean()
    const matchingSubmissionIds = matchingSubmissions.map(s => s.submissionId)

    const or: FilterQuery<ValidationIssue>[] = [
      { submissionId: pattern },
      { message: pattern },
      { type: pattern }
    ]
    if (matchingSubmissionIds.length) {
      or.push({ submissionId: { $in: matchingSubmissionIds } })
    }
    filter.$or = or
  }

  const pageNumber = Math.max(1, Number(page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(limit) || 25))

  const [issues, total] = await Promise.all([
    ValidationIssueModel.find(filter)
      .sort({ createdAt: -1 })
      .skip((pageNumber - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    ValidationIssueModel.countDocuments(filter)
  ])

  const submissionIds = [...new Set(issues.map(i => i.submissionId))]
  const submissions = await SubmissionModel.find({ cycleId, submissionId: { $in: submissionIds } })
    .select('submissionId mappedFields')
    .lean()
  const fullNameBySubmissionId = new Map<string, string>()
  for (const submission of submissions) {
    const fullName = String(submission.mappedFields?.FullName || '').trim()
    if (fullName) fullNameBySubmissionId.set(submission.submissionId, fullName)
  }

  const issuesWithFullName = issues.map(issue => ({
    ...issue,
    fullName: fullNameBySubmissionId.get(issue.submissionId) || issue.submissionId
  }))

  return {
    issues: issuesWithFullName,
    total,
    page: pageNumber,
    limit: pageSize
  }
})
