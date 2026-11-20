import type { PipelineStage } from 'mongoose'
import { SubmissionModel } from '../../models/Submission'
import { literalSearch } from '../../utils/submissionEditing'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  await connectDb()
  const query = getQuery(event) as Record<string, string>
  if (!query.cycleId || ['cycleId', 'applicationId', 'stageId', 'labelId', 'q', 'page', 'minDays'].some(key => query[key] != null && typeof query[key] !== 'string')) {
    throw createError({ statusCode: 400, statusMessage: 'cycleId and single-valued filters are required' })
  }
  const page = Math.max(1, Number.parseInt(query.page || '1') || 1)
  const limit = 25
  const match: Record<string, unknown> = { cycleId: query.cycleId, status: { $not: /^withdrawn$/i } }
  if (query.applicationId) match.applicationId = query.applicationId
  if (query.stageId) match.currentStageId = query.stageId
  if (query.labelId) match.labelIds = query.labelId
  if (query.q?.trim()) {
    const regex = { $regex: literalSearch(query.q.trim().slice(0, 200)), $options: 'i' }
    match.$or = ['submissionId', 'mappedFields.FullName', 'mappedFields.FirstName', 'mappedFields.LastName', 'mappedFields.Email'].map(key => ({ [key]: regex }))
  }
  const pipeline: PipelineStage[] = [
    { $match: match },
    { $lookup: { from: 'applications', let: { applicationId: '$applicationId', cycleId: '$cycleId' }, pipeline: [
      { $match: { $expr: { $and: [{ $eq: [{ $toString: '$_id' }, '$$applicationId'] }, { $eq: ['$cycleId', '$$cycleId'] }] } } },
      { $project: { name: 1, initialFormId: 1 } }
    ], as: 'application' } },
    { $unwind: '$application' },
    { $lookup: { from: 'formentries', let: { submissionId: '$submissionId', cycleId: '$cycleId', applicationId: '$applicationId', formId: '$application.initialFormId' }, pipeline: [
      { $match: { $expr: { $and: [
        { $eq: ['$submissionId', '$$submissionId'] }, { $eq: ['$cycleId', '$$cycleId'] },
        { $eq: ['$applicationId', '$$applicationId'] }, { $eq: ['$formId', '$$formId'] }, { $eq: ['$formType', 'initial'] }
      ] } } },
      { $project: { entryId: 1, editingState: 1, editingCheckedAt: 1, openedForEditingAt: 1 } }
    ], as: 'initialEntries' } },
    { $match: { 'initialEntries.0': { $exists: true }, 'initialEntries.1': { $exists: false } } },
    { $set: { editing: { $first: '$initialEntries' } } },
    { $match: { 'editing.editingState': 'open', 'editing.editingCheckedAt': { $type: 'date' } } }
  ]
  if (['7', '14'].includes(query.minDays || '')) pipeline.push({ $match: { 'editing.openedForEditingAt': { $lte: new Date(Date.now() - Number(query.minDays) * 86400000) } } })
  pipeline.push({ $facet: {
    count: [{ $count: 'total' }],
    rows: [
      { $set: { missingOpeningDate: { $cond: [{ $eq: [{ $type: '$editing.openedForEditingAt' }, 'date'] }, 0, 1] } } },
      { $sort: { 'missingOpeningDate': 1, 'editing.openedForEditingAt': 1, 'submissionId': 1 } },
      { $skip: (page - 1) * limit }, { $limit: limit },
      { $lookup: { from: 'editingreminders', let: { submissionId: '$submissionId', cycleId: '$cycleId' }, pipeline: [
        { $match: { $expr: { $and: [{ $eq: ['$submissionId', '$$submissionId'] }, { $eq: ['$cycleId', '$$cycleId'] }] } } },
        { $group: { _id: null, reminderCount: { $sum: { $cond: [{ $in: ['$status', ['sent', 'audit_failed']] }, 1, 0] } }, lastReminderAt: { $max: '$sentAt' }, needsReview: { $sum: { $cond: [{ $in: ['$status', ['pending', 'sending', 'uncertain', 'audit_failed']] }, 1, 0] } } } }
      ], as: 'reminder' } },
      { $project: { _id: 1, submissionId: 1, submissionIdInt: 1, applicationId: 1, applicationName: '$application.name', status: 1, currentStageName: 1, editing: 1, reminder: { $first: '$reminder' }, mappedFields: { FullName: '$mappedFields.FullName', FirstName: '$mappedFields.FirstName', LastName: '$mappedFields.LastName', Email: '$mappedFields.Email', ParentEmail: '$mappedFields.ParentEmail' } } }
    ]
  } })
  const [result] = await SubmissionModel.aggregate(pipeline)
  return { submissions: result?.rows || [], total: result?.count?.[0]?.total || 0, page, limit }
})
