import { createHmac, timingSafeEqual } from 'node:crypto'
import { Readable } from 'node:stream'
import type { Submission } from '../../models/Submission'
import { CycleModel } from '../../models/Cycle'
import { MetadataModel } from '../../models/Metadata'
import { SubmissionModel } from '../../models/Submission'

const applicantFields = [
  'submissionId', 'submissionIdInt', 'submissionDate', 'Application', 'Year',
  'StudentNumber', 'FirstName', 'LastName', 'FullName', 'DOB',
  'ParentFirstName', 'ParentLastName', 'ParentPhone', 'ParentEmail'
] as const
const selection = 'submissionId submissionIdInt completedAt cycleId projectId mappedFields.StudentNumber mappedFields.FirstName mappedFields.LastName mappedFields.FullName mappedFields.DOB mappedFields.ParentFirstName mappedFields.ParentLastName mappedFields.ParentPhone mappedFields.ParentEmail'
type ApplicantSubmission = Pick<Submission, 'submissionId' | 'submissionIdInt' | 'completedAt' | 'cycleId' | 'projectId' | 'mappedFields'>

async function mapApplicants(submissions: ApplicantSubmission[]) {
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

  return submissions.map((submission) => {
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
  })
}

function csvCell(value: unknown) {
  let text = value == null ? '' : value instanceof Date ? value.toISOString() : String(value)
  // Quoting alone does not stop spreadsheet applications from evaluating formulas.
  if (typeof value === 'string' && (/^\s*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text))) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}

function csvPhone(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') return value
  const phone = String(value).trim()
  if (!/^\+?[\d(][\d(). -]*$/.test(phone)) return value
  let digits = phone.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1)
  else if (digits.length !== 10 || phone.startsWith('+')) return value
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

async function* csvRows(filter: { status: { $not: RegExp } }) {
  yield `${applicantFields.join(',')}\r\n`
  const cursor = SubmissionModel.find(filter).select(selection).sort({ _id: 1 }).lean().cursor()
  let batch: ApplicantSubmission[] = []
  async function* flush() {
    for (const applicant of await mapApplicants(batch)) {
      yield `${applicantFields.map(field => csvCell(field === 'ParentPhone' ? csvPhone(applicant[field]) : applicant[field])).join(',')}\r\n`
    }
    batch = []
  }
  try {
    for await (const submission of cursor) {
      batch.push(submission)
      if (batch.length >= 250) yield* flush()
    }
    if (batch.length) yield* flush()
  } finally {
    await cursor.close()
  }
}

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
  const format = query.format ?? 'json'
  if (format !== 'json' && format !== 'csv') {
    throw createError({ statusCode: 400, statusMessage: 'format must be json or csv' })
  }
  if (format === 'csv') {
    await connectDb()
    setHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
    setHeader(event, 'Content-Disposition', 'attachment; filename="applicants.csv"')
    setHeader(event, 'Cache-Control', 'no-store')
    return sendStream(event, Readable.from(csvRows({ status: { $not: /^withdrawn$/i } })))
  }

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
      .select(selection)
      .sort({ _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    SubmissionModel.countDocuments(filter)
  ])

  return {
    applicants: await mapApplicants(submissions),
    total,
    page,
    limit
  }
})
