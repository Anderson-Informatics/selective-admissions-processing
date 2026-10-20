import { createHmac, timingSafeEqual } from 'node:crypto'
import { CycleModel } from '../../models/Cycle'
import { MetadataModel } from '../../models/Metadata'
import { SubmissionModel } from '../../models/Submission'

export default defineEventHandler(async (event) => {
  const { dataKey, dataSecret } = useRuntimeConfig()
  if (!dataKey || !dataSecret) {
    throw createError({ statusCode: 503, statusMessage: 'Service Unavailable' })
  }

  const authorization = getHeader(event, 'authorization')
  const suppliedKey = /^Bearer ([^\s]+)$/i.exec(authorization || '')?.[1]
  const digest = (key: string) => createHmac('sha256', dataSecret).update(key).digest()
  if (!suppliedKey || !timingSafeEqual(digest(suppliedKey), digest(dataKey))) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const query = getQuery(event)
  const page = Number(query.page ?? 1)
  const limit = Number(query.limit ?? 100)
  if (Array.isArray(query.page) || Array.isArray(query.limit)
    || !Number.isSafeInteger(page) || page < 1
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 100
    || (page - 1) * limit > Number.MAX_SAFE_INTEGER) {
    throw createError({ statusCode: 400, statusMessage: 'page and limit must be positive integers (limit <= 100)' })
  }

  await connectDb()
  const filter = { status: { $not: /^withdrawn$/i } }
  const [submissions, total] = await Promise.all([
    SubmissionModel.find(filter)
      .select('submissionId submissionIdInt completedAt cycleId projectId mappedFields.StudentNumber mappedFields.FirstName mappedFields.LastName mappedFields.FullName mappedFields.DOB mappedFields.ParentFirstName mappedFields.ParentLastName mappedFields.ParentPhone mappedFields.ParentEmail')
      .sort({ _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    SubmissionModel.countDocuments(filter)
  ])
  const projectIds = [...new Set(submissions.map(submission => submission.projectId).filter((id): id is string => !!id))]
  const cycleIds = [...new Set(submissions.map(submission => submission.cycleId).filter((id): id is string => !!id))]
  const [projects, cycles] = await Promise.all([
    projectIds.length
      ? MetadataModel.find({ type: 'project', externalId: { $in: projectIds } }).select('externalId name').lean()
      : [],
    cycleIds.length
      ? CycleModel.find({ _id: { $in: cycleIds } }).select('_id year').lean()
      : []
  ])
  const projectNames = new Map(projects.map(project => [project.externalId, project.name]))
  const cycleYears = new Map(cycles.map(cycle => [String(cycle._id), cycle.year]))

  return {
    applicants: submissions.map((submission) => {
      const fields = submission.mappedFields || {}
      return {
        submissionId: submission.submissionId,
        submissionIdInt: submission.submissionIdInt ?? null,
        submissionDate: submission.completedAt ?? null,
        Application: projectNames.get(submission.projectId) ?? null,
        Year: cycleYears.get(submission.cycleId) ?? null,
        StudentNumber: fields.StudentNumber ?? null,
        FirstName: fields.FirstName ?? null,
        LastName: fields.LastName ?? null,
        FullName: fields.FullName ?? null,
        DOB: fields.DOB ?? null,
        ParentFirstName: fields.ParentFirstName ?? null,
        ParentLastName: fields.ParentLastName ?? null,
        ParentPhone: fields.ParentPhone ?? null,
        ParentEmail: fields.ParentEmail ?? null
      }
    }),
    total,
    page,
    limit
  }
})
