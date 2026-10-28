import { ValidationIssueModel } from '../../../models/ValidationIssue'
import { reconcileValidationLabelsForSubmission } from '../../../utils/validationLabels'

export default defineEventHandler(async (event) => {
  await connectDb()
  const user = await requireAuth(event)

  const { id } = getRouterParams(event)
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Issue id is required' })
  }

  const now = new Date()
  const issue = await ValidationIssueModel.findByIdAndUpdate(
    id,
    {
      $set: {
        status: 'resolved',
        resolution: 'override',
        resolvedAt: now,
        resolvedBy: user.email,
        updatedAt: now
      }
    },
    { returnDocument: 'after' }
  ).lean()

  if (!issue) {
    throw createError({ statusCode: 404, statusMessage: 'Issue not found' })
  }

  try {
    await reconcileValidationLabelsForSubmission(issue.cycleId, issue.submissionId)
  } catch {
    throw createError({ statusCode: 502, statusMessage: 'Issue resolved, but Submittable labels could not be updated. Run validation again to retry.' })
  }

  return issue
})
