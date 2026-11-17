import type { HydratedDocument } from 'mongoose'
import { CycleModel } from '../models/Cycle'
import { MessageTemplateModel } from '../models/MessageTemplate'
import { ReviewModel } from '../models/Review'
import { ReviewStageModel } from '../models/ReviewStage'
import { SubmissionModel } from '../models/Submission'
import type { Job, JobProgress } from '../models/Job'
import { recordDisclosure } from './disclosureAudit'
import { examSessionTokens } from './examScheduling'
import { loadExamScheduleContext, resolveGroupLabelIds } from './examSchedulingRun'
import { renderMergeFields } from './routingActions'
import { buildRoutingContext, loadListOptionLabels, loadResponseLibraries } from './routingRun'
import { normalizeRoutingConfig } from './routingConfig'
import { addSubmissionLabelBulk, sendSubmissionMessage, type SubmittableClientConfig } from './submittable'
import { mapWithConcurrency } from './concurrency'

interface FinalizePayload {
  sessionLabelId?: string
  sessionName?: string
  templateId?: string
  assignments?: Record<string, string>
}

export async function runExamScheduleFinalize(options: {
  cycleId: string
  payload: FinalizePayload
  setProgress?: (progress: Partial<JobProgress>) => Promise<void>
  submittable?: SubmittableClientConfig
}, job?: HydratedDocument<Job>) {
  const { cycleId, payload, setProgress, submittable } = options
  const sessionLabelId = payload.sessionLabelId
  const assignments = payload.assignments || {}
  if (!sessionLabelId) throw new Error('exam_schedule_finalize payload is missing sessionLabelId')
  if (!payload.templateId) throw new Error('exam_schedule_finalize payload is missing templateId')

  const context = await loadExamScheduleContext(cycleId)
  if (!context) throw new Error(`Cycle ${cycleId} not found`)
  const { config } = context
  const sessionName = payload.sessionName || `session ${sessionLabelId}`

  const template = await MessageTemplateModel.findById(payload.templateId).lean()
  if (!template) throw new Error('Configured message template no longer exists')

  const { labelIdsByGroup, missing } = resolveGroupLabelIds(context)
  if (missing.length) throw new Error(`Missing Submittable labels: ${missing.join(', ')}`)

  // Phase 1: apply group labels in Submittable and mirror them locally.
  await setProgress?.({ phase: 'labels', message: 'Applying exam group labels', processed: 0 })
  const labelPairs = Object.entries(assignments).flatMap(([submissionId, groupKey]) =>
    (labelIdsByGroup[groupKey] || []).map(labelId => ({ submissionId, labelId }))
  )
  const labelIds = [...new Set(labelPairs.map(pair => pair.labelId))]
  const unapplied: { submissionIds: string[], labelId: string }[] = []
  let labelsProcessed = 0
  for (const labelId of labelIds) {
    const submissionIds = labelPairs.filter(pair => pair.labelId === labelId).map(pair => pair.submissionId)
    const missed = await addSubmissionLabelBulk(submissionIds, labelId, submittable)
    if (missed.length) unapplied.push({ submissionIds: missed, labelId })
    labelsProcessed += submissionIds.length
    await setProgress?.({ phase: 'labels', processed: labelsProcessed, total: labelPairs.length, percent: Math.round((labelsProcessed / Math.max(labelPairs.length, 1)) * 30) })
  }

  const labelsBySubmission = new Map<string, string[]>()
  for (const pair of labelPairs) {
    const list = labelsBySubmission.get(pair.submissionId) || []
    list.push(pair.labelId)
    labelsBySubmission.set(pair.submissionId, list)
  }
  await SubmissionModel.bulkWrite([...labelsBySubmission.entries()].map(([submissionId, ids]) => ({
    updateOne: { filter: { submissionId }, update: { $addToSet: { labelIds: { $each: ids } } } }
  })))

  // Phase 2: render + send the message per submission.
  const submissionIds = Object.keys(assignments)
  const [submissions, stages, reviews, optionLabels, libraries] = await Promise.all([
    SubmissionModel.find({ cycleId, submissionId: { $in: submissionIds } }).lean(),
    ReviewStageModel.find({ cycleId }).lean(),
    ReviewModel.find({ cycleId, submissionId: { $in: submissionIds } }).lean(),
    loadListOptionLabels(cycleId),
    loadResponseLibraries()
  ])
  const stagesByApplication = new Map<string, typeof stages>()
  for (const stage of stages) {
    const list = stagesByApplication.get(String(stage.applicationId)) || []
    list.push(stage)
    stagesByApplication.set(String(stage.applicationId), list)
  }
  const reviewsBySubmission = new Map<string, typeof reviews>()
  for (const review of reviews) {
    const list = reviewsBySubmission.get(review.submissionId) || []
    list.push(review)
    reviewsBySubmission.set(review.submissionId, list)
  }

  let sent = 0
  const sendErrors: { submissionId: string, error: string }[] = []
  await mapWithConcurrency(submissions, 3, async (submission) => {
    try {
      const routingStages = (stagesByApplication.get(String(submission.applicationId)) || []).map(stage => ({
        stageId: stage.stageId,
        name: stage.name,
        order: stage.order,
        role: stage.role || 'work' as const,
        routing: normalizeRoutingConfig(stage.routing)
      }))
      const routingContext = buildRoutingContext(submission, routingStages, reviewsBySubmission.get(submission.submissionId) || [])
      routingContext.examSession = { ...examSessionTokens(assignments[submission.submissionId] || '', sessionName, config) }
      const subject = renderMergeFields(template.subject, routingContext, { optionLabels, libraries })
      const rendered = renderMergeFields(template.bodyHtml, routingContext, { mode: 'html', optionLabels, libraries })
      await sendSubmissionMessage({ submissionIds: [submission.submissionId], subject: subject.text, body: rendered.text }, submittable)
      await recordDisclosure({
        actor: job?.createdBy || 'system',
        action: 'applicant_message_sent',
        entityType: 'submission',
        entityId: submission.submissionId,
        detail: { subject: subject.text, examSchedule: { sessionLabelId, groupKey: assignments[submission.submissionId] } }
      })
      sent += 1
    } catch (error) {
      sendErrors.push({ submissionId: submission.submissionId, error: error instanceof Error ? error.message : String(error) })
    }
    await setProgress?.({
      phase: 'sending',
      processed: sent + sendErrors.length,
      total: submissions.length,
      percent: 30 + Math.round(((sent + sendErrors.length) / Math.max(submissions.length, 1)) * 65),
      message: `Sent ${sent} of ${submissions.length} messages`
    })
  })

  // Phase 3: persist the schedule so examSession.* merge fields resolve later.
  const schedule = {
    sessionLabelId,
    sessionName,
    generatedAt: new Date().toISOString(),
    jobId: job ? String(job._id) : undefined,
    assignments
  }
  await CycleModel.updateOne(
    { _id: cycleId },
    { $set: { [`examScheduling.schedules.${sessionLabelId}`]: schedule } }
  )

  await setProgress?.({ phase: 'completed', processed: submissions.length, total: submissions.length, percent: 100, message: `Exam schedule finalized: ${sent} messages sent` })
  return { sent, sendErrors, labelsApplied: labelPairs.length - unapplied.reduce((n, item) => n + item.submissionIds.length, 0), unappliedLabels: unapplied }
}
