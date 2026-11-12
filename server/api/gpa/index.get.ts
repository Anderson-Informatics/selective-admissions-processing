import { ApplicationModel } from '~~/server/models/Application'
import { GpaRecordModel } from '~~/server/models/GpaRecord'
import { MetadataModel } from '~~/server/models/Metadata'
import { ReviewModel } from '~~/server/models/Review'
import { SubmissionModel } from '~~/server/models/Submission'
import { canonicalGpaStatus } from '~~/server/utils/routingEvaluator'

const GPA_STATUSES = new Set(['Complete', 'Partial', 'DPSCD Partial', 'Opt-In Partial', 'Incomplete'])
const GPA_SOURCES = new Set(['recording', 'dpscd', 'optIn', 'partial', 'none'])
const sortFields = new Set([
  'submissionIdInt', 'student', 'gpaStatus', 'resolvedCumulativeGpa',
  'resolvedSource', 'enrollmentConsidered', 'currentStageName', 'status',
  'updatedAtTimestamp', 'gpa.updatedAt'
])

function completedReviewLookup(stage: string, matcher: Record<string, unknown>) {
  return {
    from: ReviewModel.collection.name,
    let: { submissionId: '$submissionId', cycleId: '$cycleId' },
    pipeline: [
      { $match: { $expr: { $and: [
        { $eq: ['$submissionId', '$$submissionId'] },
        { $eq: ['$cycleId', '$$cycleId'] }
      ] } } },
      { $match: { $and: [
        { $or: [{ status: { $regex: /^complete(d)?$/i } }, { completedAt: { $exists: true, $ne: null } }] },
        matcher
      ] } },
      { $project: { stageName: 1, status: 1, mappedData: 1, completedAt: 1, createdAt: 1 } },
      { $sort: { completedAt: -1 as const, createdAt: -1 as const } },
      { $limit: 1 }
    ],
    as: stage
  }
}

export default defineEventHandler(async (event) => {
  await connectDb()
  await requireAuth(event)

  const {
    cycleId,
    search = '',
    gpaStatus = '',
    source = '',
    sortBy = 'student',
    sortOrder = 'asc',
    page = '1',
    limit = '100'
  } = getQuery(event) as Record<string, string>
  if (!cycleId) throw createError({ statusCode: 400, statusMessage: 'cycleId is required' })

  const pageNum = Math.max(1, parseInt(page, 10) || 1)
  const limitNum = Math.min(500, Math.max(1, parseInt(limit, 10) || 100))
  const requestedStatus = canonicalGpaStatus(gpaStatus)
  const optInLabel = await MetadataModel.findOne({ type: 'label', name: { $regex: /^\s*opt[-\s]?in\s*$/i } }).select('externalId').lean()
  const term = search.trim().slice(0, 200)
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const searchFilter: Record<string, unknown> = term
    ? { $or: [
        { student: { $regex: escaped, $options: 'i' } },
        { 'gpa.dpscd.studentName': { $regex: escaped, $options: 'i' } },
        { 'gpa.optIn.studentName': { $regex: escaped, $options: 'i' } },
        ...(/^\d+$/.test(term) && Number.isSafeInteger(Number(term))
          ? [{ submissionIdInt: Number(term) }, { 'gpa.dpscd.studentNumber': Number(term) }]
          : [])
      ] }
    : {}
  const statusFilter = requestedStatus && GPA_STATUSES.has(requestedStatus) ? { gpaStatus: requestedStatus } : {}
  const sourceFilter = source && GPA_SOURCES.has(source)
    ? source === 'none'
      ? { $or: [{ 'gpa.resolvedSource': null }, { gpa: null }, { 'gpa.resolvedSource': { $exists: false } }] }
      : { 'gpa.resolvedSource': source }
    : {}
  const field = sortFields.has(sortBy) ? sortBy : 'student'
  const direction = sortOrder === 'desc' ? -1 : 1

  const [result] = await SubmissionModel.aggregate([
    { $match: { cycleId, status: { $not: /^withdrawn$/i } } },
    { $lookup: {
      from: GpaRecordModel.collection.name,
      let: { submissionId: '$submissionId', cycleId: '$cycleId' },
      pipeline: [
        { $match: { $expr: { $and: [
          { $eq: ['$submissionId', '$$submissionId'] },
          { $eq: ['$cycleId', '$$cycleId'] }
        ] } } },
        { $limit: 1 }
      ],
      as: '_gpa'
    } },
    { $set: { gpa: { $arrayElemAt: ['$_gpa', 0] } } },
    { $lookup: completedReviewLookup('_recordingReviews', { stageName: { $regex: /^\s*gpa\s*recording\s*$/i } }) },
    { $lookup: completedReviewLookup('_partialReviews', { $or: [
      { stageName: { $regex: /partial\s*gpa|gpa\s*partial/i } },
      { 'mappedData.PartialGPA': { $exists: true } }
    ] }) },
    { $set: {
      submissionName: {
        $let: {
          vars: {
            fullName: { $trim: { input: { $ifNull: ['$mappedFields.FullName', ''] } } },
            fallbackName: { $trim: { input: { $concat: [{ $ifNull: ['$mappedFields.FirstName', ''] }, ' ', { $ifNull: ['$mappedFields.LastName', ''] }] } } }
          },
          in: { $cond: [{ $ne: ['$$fullName', ''] }, '$$fullName', '$$fallbackName'] }
        }
      },
      recordingReview: { $arrayElemAt: ['$_recordingReviews', 0] },
      partialReview: { $arrayElemAt: ['$_partialReviews', 0] },
      hasOptInLabel: optInLabel ? { $in: [optInLabel.externalId, { $ifNull: ['$labelIds', []] }] } : false,
      gpaStatus: {
        $cond: [
          { $eq: ['$gpaStatus', 'OOD Partial'] },
          'Opt-In Partial',
          { $ifNull: ['$gpaStatus', 'Incomplete'] }
        ]
      },
      resolvedCumulativeGpa: { $ifNull: ['$gpa.resolvedCumulativeGpa', null] },
      resolvedSource: { $ifNull: ['$gpa.resolvedSource', null] }
    } },
    { $set: {
      student: {
        $cond: [
          { $ne: ['$submissionName', ''] },
          '$submissionName',
          { $ifNull: ['$gpa.optIn.studentName', ''] }
        ]
      },
      enrollmentConsidered: {
        $switch: {
          branches: [
            { case: { $eq: ['$resolvedSource', 'recording'] }, then: 'Recorded' },
            { case: { $eq: ['$resolvedSource', 'partial'] }, then: { $ifNull: ['$partialReview.mappedData.Semesters', '—'] } },
            { case: { $eq: ['$resolvedSource', 'dpscd'] }, then: { $ifNull: ['$gpa.dpscd.quartersAvailable', null] } },
            { case: { $eq: ['$resolvedSource', 'optIn'] }, then: { $ifNull: ['$gpa.optIn.termsEnrolled', null] } },
            { case: { $eq: ['$gpaStatus', 'DPSCD Partial'] }, then: { $ifNull: ['$gpa.dpscd.quartersAvailable', null] } },
            { case: { $eq: ['$gpaStatus', 'Opt-In Partial'] }, then: { $ifNull: ['$gpa.optIn.termsEnrolled', null] } }
          ],
          default: null
        }
      }
    } },
    { $match: { $and: [searchFilter, statusFilter, sourceFilter] } },
    { $facet: {
      records: [
        { $sort: { [field]: direction, _id: 1 } },
        { $skip: (pageNum - 1) * limitNum },
        { $limit: limitNum },
        { $project: {
          entryIds: 0,
          routingHistory: 0,
          mappedFields: 0,
          _gpa: 0,
          _recordingReviews: 0,
          _partialReviews: 0
        } }
      ],
      count: [{ $count: 'total' }]
    } }
  ]).collation({ locale: 'en', strength: 2 })

  const duplicateRows = await SubmissionModel.aggregate([
    { $match: { cycleId } },
    { $set: {
      duplicateStudentNumber: {
        $trim: {
          input: {
            $convert: {
              input: { $ifNull: ['$mappedFields.StudentNumber', ''] },
              to: 'string',
              onError: '',
              onNull: ''
            }
          }
        }
      },
      student: {
        $let: {
          vars: {
            fullName: { $trim: { input: { $ifNull: ['$mappedFields.FullName', ''] } } },
            fallbackName: { $trim: { input: { $concat: [{ $ifNull: ['$mappedFields.FirstName', ''] }, ' ', { $ifNull: ['$mappedFields.LastName', ''] }] } } }
          },
          in: { $cond: [{ $ne: ['$$fullName', ''] }, '$$fullName', '$$fallbackName'] }
        }
      }
    } },
    { $match: { duplicateStudentNumber: { $ne: '' } } },
    { $lookup: {
      from: GpaRecordModel.collection.name,
      let: { submissionId: '$submissionId', cycleId: '$cycleId' },
      pipeline: [
        { $match: { $expr: { $and: [
          { $eq: ['$submissionId', '$$submissionId'] },
          { $eq: ['$cycleId', '$$cycleId'] }
        ] } } },
        { $limit: 1 }
      ],
      as: '_gpa'
    } },
    { $set: { gpa: { $arrayElemAt: ['$_gpa', 0] } } },
    { $group: {
      _id: '$duplicateStudentNumber',
      duplicateCount: { $sum: 1 },
      submissions: { $push: {
        submissionId: '$submissionId',
        submissionIdInt: '$submissionIdInt',
        applicationId: '$applicationId',
        projectId: '$projectId',
        student: '$student',
        status: '$status',
        currentStageName: '$currentStageName',
        gpaStatus: '$gpaStatus',
        resolvedCumulativeGpa: '$gpa.resolvedCumulativeGpa',
        resolvedSource: '$gpa.resolvedSource',
        dpscdStudentName: '$gpa.dpscd.studentName',
        dpscdStudentNumber: '$gpa.dpscd.studentNumber'
      } }
    } },
    { $match: { duplicateCount: { $gt: 1 } } },
    { $unwind: '$submissions' },
    { $replaceRoot: { newRoot: { $mergeObjects: ['$submissions', { studentNumber: '$_id', duplicateCount: '$duplicateCount' }] } } },
    { $sort: { studentNumber: 1, submissionIdInt: 1, submissionId: 1 } }
  ]) as Array<Record<string, unknown>>

  const applications = await ApplicationModel.find({ cycleId }).select('name').lean()
  const applicationNames = new Map(applications.map(application => [String(application._id), application.name]))
  const duplicateStudentNumbers = duplicateRows.map(row => ({
    ...row,
    applicationName: applicationNames.get(String(row.applicationId || '')) || '',
    gpaStatus: canonicalGpaStatus(row.gpaStatus || 'Incomplete')
  }))

  return { records: result?.records || [], total: result?.count[0]?.total || 0, page: pageNum, limit: limitNum, duplicateStudentNumbers }
})
