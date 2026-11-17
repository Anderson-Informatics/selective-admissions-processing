import { CycleModel } from '../models/Cycle'
import { MetadataModel } from '../models/Metadata'
import { ReviewModel } from '../models/Review'
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
    SubmissionModel.find({ cycleId }).select('submissionId status labelIds reviewCompletion').lean(),
    MetadataModel.find({ type: 'label' }).select('externalId name').lean()
  ])
  return { cycle, config, labels, submissions: submissions as SchedulableSubmission[] }
}

export async function computeSessionAssignment(
  context: ExamScheduleContext,
  sessionLabelId: string
): Promise<ExamAssignmentResult> {
  const memberIds = context.submissions
    .filter(submission => (submission.labelIds || []).includes(sessionLabelId))
    .map(submission => submission.submissionId)
  const reviews = await ReviewModel.find({ cycleId: String(context.cycle._id), submissionId: { $in: memberIds } })
    .select('submissionId stageName status completedAt mappedData')
    .lean()
  const reviewsBySubmission = new Map<string, ExamReviewInput[]>()
  for (const review of reviews) {
    const list = reviewsBySubmission.get(review.submissionId) || []
    list.push(review as ExamReviewInput)
    reviewsBySubmission.set(review.submissionId, list)
  }
  return assignGroups({
    submissions: context.submissions,
    labels: context.labels,
    reviewsBySubmission,
    sessionLabelId,
    config: context.config
  })
}

/** Resolves group label names → Submittable labelIds; returns per-group ids plus any missing names. */
export function resolveGroupLabelIds(context: ExamScheduleContext): { labelIdsByGroup: Record<string, string[]>, missing: string[] } {
  const idByName = new Map(context.labels.map(label => [label.name.trim().toLowerCase(), label.externalId]))
  const labelIdsByGroup: Record<string, string[]> = {}
  const missing: string[] = []
  for (const def of EXAM_GROUP_DEFS) {
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

