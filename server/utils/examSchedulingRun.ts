import { CycleModel } from '../models/Cycle'
import { MetadataModel } from '../models/Metadata'
import { ReviewModel } from '../models/Review'
import { ReviewStageModel } from '../models/ReviewStage'
import { SubmissionModel } from '../models/Submission'
import {
  assignGroups,
  EXAM_GROUP_DEFS,
  groupLabelNames,
  normalizeExamSchedulingConfig,
  type ExamAssignmentResult,
  type ExamReviewInput,
  type ExamSchedulingConfig,
  type LabelInfo,
  type SchedulableSubmission
} from './examScheduling'

export interface ExamScheduleContext {
  cycle: { _id: unknown, examScheduling?: Record<string, unknown> }
  config: ExamSchedulingConfig
  labels: LabelInfo[]
  submissions: SchedulableSubmission[]
}

export async function loadExamScheduleContext(cycleId: string): Promise<ExamScheduleContext | null> {
  const cycle = await CycleModel.findById(cycleId).select('examScheduling').lean()
  if (!cycle) return null
  const config = normalizeExamSchedulingConfig(cycle.examScheduling as Record<string, unknown> | undefined)
  const [submissions, labels] = await Promise.all([
    SubmissionModel.find({ cycleId }).select('submissionId applicationId submissionIdInt mappedFields.FullName mappedFields.FirstName mappedFields.LastName status labelIds reviewCompletion').lean(),
    MetadataModel.find({ type: 'label' }).select('externalId name').lean()
  ])
  return { cycle, config, labels, submissions: submissions as SchedulableSubmission[] }
}

export async function computeSessionAssignment(
  context: ExamScheduleContext,
  sessionLabelId: string,
  additionalMemberIds: string[] = []
): Promise<ExamAssignmentResult> {
  const included = new Set(additionalMemberIds)
  const submissions = context.submissions.map(submission => included.has(submission.submissionId)
    ? { ...submission, labelIds: [...new Set([...(submission.labelIds || []), sessionLabelId])] }
    : submission)
  const memberIds = submissions
    .filter(submission => (submission.labelIds || []).includes(sessionLabelId))
    .map(submission => submission.submissionId)
  const cycleId = String(context.cycle._id)
  const [reviews, stages] = await Promise.all([
    ReviewModel.find({ cycleId, submissionId: { $in: memberIds } })
      .select('submissionId applicationId stageId stageName status completedAt createdAt mappedData')
      .lean(),
    ReviewStageModel.find({ cycleId }).select('applicationId stageId name').lean()
  ])
  const reviewsBySubmission = new Map<string, ExamReviewInput[]>()
  for (const review of reviews) {
    const list = reviewsBySubmission.get(review.submissionId) || []
    list.push(review as ExamReviewInput)
    reviewsBySubmission.set(review.submissionId, list)
  }
  return assignGroups({
    submissions,
    stages,
    labels: context.labels,
    reviewsBySubmission,
    sessionLabelId,
    config: context.config
  })
}

/** Resolves group label names → Submittable labelIds; returns per-group ids plus any missing names. Only used groups are required. */
export function resolveGroupLabelIds(
  context: ExamScheduleContext,
  usedGroupKeys?: Iterable<string>
): { labelIdsByGroup: Record<string, string[]>, missing: string[] } {
  const required = usedGroupKeys ? new Set(usedGroupKeys) : undefined
  const idByName = new Map(context.labels.map(label => [label.name.trim().toLowerCase(), label.externalId]))
  const labelIdsByGroup: Record<string, string[]> = {}
  const missing: string[] = []
  for (const def of EXAM_GROUP_DEFS) {
    if (required && !required.has(def.key)) continue
    const ids: string[] = []
    for (const name of groupLabelNames(def, context.config)) {
      const id = idByName.get(name.trim().toLowerCase())
      if (id) ids.push(id)
      else missing.push(name)
    }
    labelIdsByGroup[def.key] = ids
  }
  return { labelIdsByGroup, missing: [...new Set(missing)] }
}
