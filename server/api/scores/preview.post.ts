import { ApplicationModel } from '../../models/Application'
import { SubmissionModel } from '../../models/Submission'
import { compileApplicationScores, computePercentiles, normalizeScoringConfig } from '../../utils/scoreCompilation'
import { resolveGpaBonusLabelId } from '../../utils/gpaScoring'

export default defineEventHandler(async (event) => {
  await connectDb()
  await requireAuth(event)
  const body = await readBody(event)
  const { cycleId, applicationId } = body as { cycleId?: string, applicationId?: string }
  if (!cycleId || !applicationId) {
    throw createError({ statusCode: 400, statusMessage: 'cycleId and applicationId are required' })
  }

  const application = await ApplicationModel.findById(applicationId).lean()
  if (!application || application.cycleId !== cycleId) {
    throw createError({ statusCode: 404, statusMessage: 'Application not found for this cycle' })
  }

  const config = normalizeScoringConfig(application.scoring)
  const gpaBonusLabelId = await resolveGpaBonusLabelId()
  const output = await compileApplicationScores({
    cycleId,
    applicationId,
    config,
    gpaBonusLabelId
  })
  const percentiles = computePercentiles(output.records)

  const submissions = await SubmissionModel.find({ cycleId, applicationId })
    .select('submissionId mappedFields.FullName mappedFields.FirstName mappedFields.LastName')
    .lean()
  const nameById = new Map(submissions.map(submission => [submission.submissionId,
    String(submission.mappedFields?.FullName || `${submission.mappedFields?.FirstName || ''} ${submission.mappedFields?.LastName || ''}`.trim() || submission.submissionId)
  ]))

  return {
    applicationId,
    applicationName: application.name,
    summary: output.summary,
    records: output.records.map(item => ({
      ...item.record,
      applicantName: nameById.get(item.submissionId) || item.submissionId,
      percentiles: percentiles.get(item.submissionId) || {}
    }))
  }
})
