import { SubmissionModel } from '../../../models/Submission'
import { resolveOptInLabelId } from '../../../utils/gpa'
import { buildOptInSchoolExport } from '../../../utils/optInExport'
import { recordDisclosure } from '../../../utils/disclosureAudit'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  await connectDb()
  const { cycleId } = getQuery(event)
  if (typeof cycleId !== 'string' || !cycleId.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'cycleId is required' })
  }
  const labelId = await resolveOptInLabelId()
  if (!labelId) throw createError({ statusCode: 409, statusMessage: 'OPT IN label could not be resolved. Sync metadata before exporting.' })
  const submissions = await SubmissionModel.find({ cycleId, labelIds: labelId, status: { $not: /^withdrawn$/i } })
    .select('submissionIdInt mappedFields.FirstName mappedFields.LastName mappedFields.DOB mappedFields.OODSchool')
    .lean()
  if (!submissions.length) throw createError({ statusCode: 404, statusMessage: 'No non-withdrawn OPT IN students found in this cycle.' })
  if (submissions.some(submission => !Number.isSafeInteger(submission.submissionIdInt))) {
    throw createError({ statusCode: 409, statusMessage: 'An Opt-In submission is missing a numeric SubmissionID. Refresh submission data before exporting.' })
  }
  const result = await buildOptInSchoolExport(submissions)
  await recordDisclosure({
    actor: user.email,
    action: 'pii_export',
    entityType: 'opt_in_school_files',
    entityId: cycleId,
    detail: { rows: result.rows, schools: result.schools }
  })
  setResponseHeader(event, 'Cache-Control', 'no-store')
  setResponseHeader(event, 'Content-Type', 'application/zip')
  setResponseHeader(event, 'Content-Disposition', 'attachment; filename="opt-in-school-files.zip"')
  return result.content
})
