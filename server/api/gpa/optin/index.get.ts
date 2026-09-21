import { GpaRecordModel } from '~~/server/models/GpaRecord'
import { MetadataModel } from '~~/server/models/Metadata'
import { SubmissionModel } from '~~/server/models/Submission'

export default defineEventHandler(async (event) => {
  await connectDb()
  await requireAuth(event)

  const { cycleId, source, page = '1', limit = '100' } = getQuery(event) as Record<string, string>
  if (!cycleId) throw createError({ statusCode: 400, statusMessage: 'cycleId is required' })

  const filter: Record<string, unknown> = { cycleId }
  if (source === 'dpscd') filter.dpscd = { $exists: true }
  else if (source === 'opt_in') filter.optIn = { $exists: true }
  else filter.$or = [{ dpscd: { $exists: true } }, { optIn: { $exists: true } }]

  const pageNum = Math.max(1, parseInt(page, 10) || 1)
  const limitNum = Math.min(500, Math.max(1, parseInt(limit, 10) || 100))

  const [records, total, optInLabel, submissions] = await Promise.all([
    GpaRecordModel.find(filter)
      .sort({ updatedAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .lean(),
    GpaRecordModel.countDocuments(filter),
    MetadataModel.findOne({ type: 'label', name: { $regex: /^\s*opt[-\s]?in\s*$/i } }).select('externalId').lean(),
    SubmissionModel.find({ cycleId }).select('submissionId labelIds mappedFields.FullName').lean()
  ])

  const labelIdsBySubmission = new Map(submissions.map(s => [s.submissionId, (s as { labelIds?: string[] }).labelIds || []]))
  const nameBySubmission = new Map(submissions.map(s => [s.submissionId, String((s.mappedFields as Record<string, unknown> | undefined)?.FullName || '')]))

  return {
    records: records.map(record => ({
      ...record,
      submissionName: nameBySubmission.get(record.submissionId) || '',
      hasOptInLabel: optInLabel ? labelIdsBySubmission.get(record.submissionId)?.includes(optInLabel.externalId) || false : false
    })),
    total,
    page: pageNum,
    limit: limitNum
  }
})
