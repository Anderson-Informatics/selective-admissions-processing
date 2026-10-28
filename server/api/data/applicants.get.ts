import { Readable } from 'node:stream'
import type { Submission } from '../../models/Submission'
import { CycleModel } from '../../models/Cycle'
import { MetadataModel } from '../../models/Metadata'
import { SubmissionModel } from '../../models/Submission'
import { csvCell, csvPhone, notWithdrawnFilter, parseDataFormat, parseDataPagination, requireDataKey } from '../../utils/dataApi'

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
  requireDataKey(event)

  const query = getQuery(event)
  const format = parseDataFormat(query)
  if (format === 'csv') {
    await connectDb()
    setHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
    setHeader(event, 'Content-Disposition', 'attachment; filename="applicants.csv"')
    setHeader(event, 'Cache-Control', 'no-store')
    return sendStream(event, Readable.from(csvRows(notWithdrawnFilter())))
  }

  const { page, limit } = parseDataPagination(query)
  await connectDb()
  const filter = notWithdrawnFilter()
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
