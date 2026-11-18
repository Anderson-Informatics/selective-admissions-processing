import { ApplicationModel } from '~~/server/models/Application'
import { GpaRecordModel } from '~~/server/models/GpaRecord'
import { SubmissionModel } from '~~/server/models/Submission'
import { canonicalGpaStatus } from '~~/server/utils/routingEvaluator'

export default defineEventHandler(async (event) => {
  await connectDb()
  await requireAuth(event)

  const { cycleId } = getQuery(event) as Record<string, string>
  if (!cycleId) throw createError({ statusCode: 400, statusMessage: 'cycleId is required' })

  const duplicateRows = await SubmissionModel.aggregate([
    { $match: { cycleId, status: { $not: /^withdrawn$/i } } },
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
    { $group: {
      _id: '$duplicateStudentNumber',
      duplicateCount: { $sum: 1 },
      submissions: { $push: {
        cycleId: '$cycleId',
        submissionId: '$submissionId',
        submissionIdInt: '$submissionIdInt',
        applicationId: '$applicationId',
        projectId: '$projectId',
        student: '$student',
        status: '$status',
        currentStageName: '$currentStageName',
        gpaStatus: '$gpaStatus'
      } }
    } },
    { $match: { duplicateCount: { $gt: 1 } } },
    { $unwind: '$submissions' },
    { $replaceRoot: { newRoot: { $mergeObjects: ['$submissions', { studentNumber: '$_id', duplicateCount: '$duplicateCount' }] } } },
    { $lookup: {
      from: GpaRecordModel.collection.name,
      let: { submissionId: '$submissionId', cycleId: '$cycleId' },
      pipeline: [
        { $match: { $expr: { $and: [
          { $eq: ['$submissionId', '$$submissionId'] },
          { $eq: ['$cycleId', '$$cycleId'] }
        ] } } },
        { $limit: 1 },
        { $project: { 'resolvedCumulativeGpa': 1, 'resolvedSource': 1, 'dpscd.studentName': 1, 'dpscd.studentNumber': 1 } }
      ],
      as: '_gpa'
    } },
    { $set: { gpa: { $arrayElemAt: ['$_gpa', 0] } } },
    { $set: {
      resolvedCumulativeGpa: '$gpa.resolvedCumulativeGpa',
      resolvedSource: '$gpa.resolvedSource',
      dpscdStudentName: '$gpa.dpscd.studentName',
      dpscdStudentNumber: '$gpa.dpscd.studentNumber'
    } },
    { $project: { cycleId: 0, gpa: 0, _gpa: 0 } },
    { $sort: { studentNumber: 1, submissionIdInt: 1, submissionId: 1 } }
  ]) as Array<Record<string, unknown>>

  const applications = duplicateRows.length ? await ApplicationModel.find({ cycleId }).select('name').lean() : []
  const applicationNames = new Map(applications.map(application => [String(application._id), application.name]))
  return duplicateRows.map(row => ({
    ...row,
    applicationName: applicationNames.get(String(row.applicationId || '')) || '',
    gpaStatus: canonicalGpaStatus(row.gpaStatus || 'Incomplete')
  }))
})
