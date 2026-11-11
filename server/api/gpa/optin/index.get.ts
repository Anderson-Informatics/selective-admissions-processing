import { GpaRecordModel } from '~~/server/models/GpaRecord'
import { MetadataModel } from '~~/server/models/Metadata'
import { SubmissionModel } from '~~/server/models/Submission'

const sortFields = new Set([
  'submissionIdInt', 'student', 'dpscd.studentNumber', 'dpscd.cumulativeGpa',
  'dpscd.quartersAvailable', 'dpscd.gpaStatus', 'dpscd.selectedRound',
  'dpscd.selectedSnapshot', 'dpscd.selectionIssue', 'dpscd.importedAt',
  'optIn.studentName', 'optIn.schoolName', 'optIn.cumulativeGpa',
  'optIn.enrolledMinTerms', 'optIn.termsEnrolled', 'optIn.sourceFile',
  'optIn.importedAt', 'hasOptInLabel', 'updatedAt'
])

export default defineEventHandler(async (event) => {
  await connectDb()
  await requireAuth(event)

  const { cycleId, source, search = '', sortBy = 'updatedAt', sortOrder = 'desc', page = '1', limit = '100' } = getQuery(event) as Record<string, string>
  if (!cycleId) throw createError({ statusCode: 400, statusMessage: 'cycleId is required' })

  const filter: Record<string, unknown> = { cycleId }
  if (source === 'dpscd') filter.dpscd = { $exists: true }
  else if (source === 'opt_in') filter.optIn = { $exists: true }
  else filter.$or = [{ dpscd: { $exists: true } }, { optIn: { $exists: true } }]

  const pageNum = Math.max(1, parseInt(page, 10) || 1)
  const limitNum = Math.min(500, Math.max(1, parseInt(limit, 10) || 100))
  const optInLabel = await MetadataModel.findOne({ type: 'label', name: { $regex: /^\s*opt[-\s]?in\s*$/i } }).select('externalId').lean()
  const term = search.trim().slice(0, 200)
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const searchFilter: Record<string, unknown> = term
    ? { $or: [
        { submissionName: { $regex: escaped, $options: 'i' } },
        { 'optIn.studentName': { $regex: escaped, $options: 'i' } },
        ...(/^\d+$/.test(term) && Number.isSafeInteger(Number(term))
          ? [{ submissionIdInt: Number(term) }, { 'dpscd.studentNumber': Number(term) }]
          : [])
      ] }
    : {}
  const field = sortFields.has(sortBy) ? sortBy : 'updatedAt'
  const direction = sortOrder === 'asc' ? 1 : -1
  const [result] = await GpaRecordModel.aggregate([
    { $match: filter },
    { $lookup: {
      from: SubmissionModel.collection.name,
      let: { submissionId: '$submissionId', cycleId: '$cycleId' },
      pipeline: [
        { $match: { $expr: { $and: [
          { $eq: ['$submissionId', '$$submissionId'] },
          { $eq: ['$cycleId', '$$cycleId'] }
        ] } } },
        { $project: { 'mappedFields.FullName': 1, 'labelIds': 1 } },
        { $limit: 1 }
      ],
      as: '_submission'
    } },
    { $set: {
      submissionName: { $ifNull: [{ $arrayElemAt: ['$_submission.mappedFields.FullName', 0] }, ''] },
      hasOptInLabel: optInLabel
        ? { $in: [optInLabel.externalId, { $ifNull: [{ $arrayElemAt: ['$_submission.labelIds', 0] }, []] }] }
        : false
    } },
    { $set: { student: { $cond: [{ $ne: ['$submissionName', ''] }, '$submissionName', { $ifNull: ['$optIn.studentName', ''] }] } } },
    { $match: searchFilter },
    { $facet: {
      records: [
        { $sort: { [field]: direction, _id: 1 } },
        { $skip: (pageNum - 1) * limitNum },
        { $limit: limitNum },
        { $unset: ['_submission', 'student'] }
      ],
      count: [{ $count: 'total' }]
    } }
  ]).collation({ locale: 'en', strength: 2 })

  return { records: result?.records || [], total: result?.count[0]?.total || 0, page: pageNum, limit: limitNum }
})
