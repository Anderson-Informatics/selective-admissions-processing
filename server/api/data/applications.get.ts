import { Readable } from 'node:stream'
import type { FormEntry } from '../../models/FormEntry'
import type { Submission } from '../../models/Submission'
import { FormEntryModel } from '../../models/FormEntry'
import { SubmissionModel } from '../../models/Submission'
import { csvCell, csvPhone, notWithdrawnFilter, parseDataFormat, parseDataPagination, requireDataKey } from '../../utils/dataApi'

const answerFields = [
  'FullName', 'FirstName', 'LastName', 'SingleAcceptance', 'GradeEntering',
  'ParentFirstName', 'ParentLastName', 'ParentEmail', 'ParentPhone', 'ParentPhone2',
  'DOB', 'Email', 'Phone', 'Address1', 'Address2', 'City', 'State', 'Zip', 'Country',
  'Gender', 'DPSCD', 'IEPorNPSPor504', 'ELL', 'ExamDate',
  'Ref1Name', 'Ref1Phone', 'Ref1Email', 'Ref1Relationship',
  'Ref2Name', 'Ref2Phone', 'Ref2Email', 'Ref2Relationship',
  'Ref3Name', 'Ref3Phone', 'Ref3Email', 'Ref3Relationship',
  'Interests', 'SignatureStudent', 'SignatureParent', 'SEMCOG', 'OODSchool',
  'FirstChoiceSchool', 'SecondChoiceSchool', 'ThirdChoiceSchool', 'Essay', 'Sports',
  'ELLStatement', 'Language', 'DPSCDSchool', 'AnotherSchoolAttend', 'StudentNumber',
  'AnotherSchool', 'UploadNonDPSCD', 'Upload504', 'OtherSchoolLocation', 'UploadIEP',
  'FourthChoiceSchool', 'FifthChoiceSchool'
] as const
const applicationFields = [
  'formType', 'submissionId', 'projectId', 'entryId', 'formId', 'status', 'completedAt',
  'createdBy', 'createdAt', 'entryVersionId', 'openedForEditingAt', ...answerFields
] as const
const phoneFields = new Set<string>(['ParentPhone', 'ParentPhone2', 'Phone', 'Ref1Phone', 'Ref2Phone', 'Ref3Phone'])
const selection = [
  'submissionId projectId status completedAt createdBy createdAt',
  ...answerFields.map(field => `mappedFields.${field}`)
].join(' ')
const entrySelection = 'submissionId formType entryId formId completedAt createdBy createdAt entryVersionId openedForEditingAt'

type ApplicationField = typeof applicationFields[number]
type Application = Record<ApplicationField, unknown>
type ApplicationSubmission = Pick<Submission, 'submissionId' | 'projectId' | 'status' | 'completedAt' | 'createdBy' | 'createdAt' | 'mappedFields'>
type InitialEntry = Pick<FormEntry, 'submissionId' | 'formType' | 'entryId' | 'formId' | 'completedAt' | 'createdBy' | 'createdAt' | 'entryVersionId' | 'openedForEditingAt'>

async function mapApplications(submissions: ApplicationSubmission[]): Promise<Application[]> {
  const submissionIds = submissions.map(submission => submission.submissionId)
  const entries: InitialEntry[] = submissionIds.length
    ? await FormEntryModel.find({ submissionId: { $in: submissionIds }, formType: 'initial' })
        .select(entrySelection)
        .sort({ createdAt: 1, _id: 1 })
        .lean()
    : []
  const initialEntries = new Map<string, InitialEntry>()
  for (const entry of entries) {
    if (!initialEntries.has(entry.submissionId)) initialEntries.set(entry.submissionId, entry)
  }

  return submissions.map((submission) => {
    const entry = initialEntries.get(submission.submissionId)
    const fields = submission.mappedFields || {}
    const application = {
      formType: entry?.formType ?? null,
      submissionId: submission.submissionId,
      projectId: submission.projectId ?? null,
      entryId: entry?.entryId ?? null,
      formId: entry?.formId ?? null,
      status: submission.status ?? null,
      completedAt: entry?.completedAt ?? submission.completedAt ?? null,
      createdBy: entry?.createdBy ?? submission.createdBy ?? null,
      createdAt: entry?.createdAt ?? submission.createdAt ?? null,
      entryVersionId: entry?.entryVersionId ?? null,
      openedForEditingAt: entry?.openedForEditingAt ?? null
    } as Application
    for (const field of answerFields) application[field] = fields[field] ?? null
    return application
  })
}

async function* csvRows() {
  yield `${applicationFields.join(',')}\r\n`
  const cursor = SubmissionModel.find(notWithdrawnFilter()).select(selection).sort({ _id: 1 }).lean().cursor()
  let batch: ApplicationSubmission[] = []
  async function* flush() {
    for (const application of await mapApplications(batch)) {
      yield `${applicationFields.map(field => csvCell(phoneFields.has(field) ? csvPhone(application[field]) : application[field])).join(',')}\r\n`
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
    setHeader(event, 'Content-Disposition', 'attachment; filename="applications.csv"')
    setHeader(event, 'Cache-Control', 'no-store')
    return sendStream(event, Readable.from(csvRows()))
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
    applications: await mapApplications(submissions),
    total,
    page,
    limit
  }
})
