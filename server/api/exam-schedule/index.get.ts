import { CycleModel } from '~~/server/models/Cycle'
import { MetadataModel } from '~~/server/models/Metadata'
import { SubmissionModel } from '~~/server/models/Submission'
import { detectSessions, EXAM_GROUP_DEFS, normalizeExamSchedulingConfig } from '~~/server/utils/examScheduling'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  await connectDb()
  const query = getQuery(event)
  const cycle = query.cycleId
    ? await CycleModel.findById(String(query.cycleId)).lean()
    : await CycleModel.findOne({ active: true }).lean()
  if (!cycle) throw createError({ statusCode: 404, statusMessage: 'Cycle not found' })

  const [submissions, labels] = await Promise.all([
    SubmissionModel.find({ cycleId: String(cycle._id) }).select('submissionId status labelIds').lean(),
    MetadataModel.find({ type: 'label' }).select('externalId name').lean()
  ])
  const config = normalizeExamSchedulingConfig(cycle.examScheduling as Record<string, unknown> | undefined)
  const sessions = detectSessions(submissions, labels, config.sessionLabelPattern)
  return {
    cycleId: String(cycle._id),
    config,
    sessions,
    groups: EXAM_GROUP_DEFS
  }
})
