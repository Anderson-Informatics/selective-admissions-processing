import { ValidationIssueModel } from '~~/server/models/ValidationIssue'

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

  return issue
})
