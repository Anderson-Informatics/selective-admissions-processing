import { createHash } from 'node:crypto'
import type { HydratedDocument } from 'mongoose'
import { ApplicationModel } from '../models/Application'
import { FormEntryModel } from '../models/FormEntry'
import { SubmissionModel } from '../models/Submission'
import { MessageTemplateModel } from '../models/MessageTemplate'
import { EditingReminderModel } from '../models/EditingReminder'
import { ReviewModel } from '../models/Review'
import { ReviewStageModel } from '../models/ReviewStage'
import type { Job, JobProgress } from '../models/Job'
import { renderMergeFields } from './routingActions'
import { buildRoutingContext, loadExamSessionContext, loadListOptionLabels, loadResponseLibraries } from './routingRun'
import { normalizeRoutingConfig } from './routingConfig'
import { editingState } from './submissionEditing'
import { fetchEntryEditingMetadata, fetchSubmission, sendSubmissionMessage, type SubmittableClientConfig } from './submittable'
import { recordDisclosure } from './disclosureAudit'

export interface ReminderInput { cycleId: string, templateId: string, submissionIds: string[] }
export interface ReminderSnapshot {
  subject: string
  bodyHtml: string
  recipients: Array<{ submissionId: string, entryId: string, formId: string, digest: string }>
}
export const reminderDigest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

export function validateReminderInput(value: unknown): ReminderInput {
  const input = value as Partial<ReminderInput> | null
  if (!input || typeof input.cycleId !== 'string' || !/^[a-f\d]{24}$/i.test(input.cycleId)
    || typeof input.templateId !== 'string' || !/^[a-f\d]{24}$/i.test(input.templateId)
    || !Array.isArray(input.submissionIds) || !input.submissionIds.length || input.submissionIds.length > 100
    || !input.submissionIds.every(id => typeof id === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(id))) {
    throw new Error('A cycle, template, and 1–100 submission IDs are required')
  }
  return { cycleId: input.cycleId, templateId: input.templateId, submissionIds: [...new Set(input.submissionIds)].sort() }
}

async function renderReminder(cycleId: string, submissionId: string, template: { subject: string, bodyHtml: string }) {
  const submission = await SubmissionModel.findOne({ cycleId, submissionId, status: { $not: /^withdrawn$/i } }).lean()
  if (!submission) throw new Error('Submission unavailable or withdrawn')
  const [stages, reviews, optionLabels, libraries, examSession] = await Promise.all([
    ReviewStageModel.find({ cycleId, applicationId: submission.applicationId }).lean(),
    ReviewModel.find({ cycleId, submissionId }).lean(),
    loadListOptionLabels(cycleId), loadResponseLibraries(), loadExamSessionContext(cycleId, submissionId)
  ])
  const context = buildRoutingContext(submission, stages.map(stage => ({ stageId: stage.stageId, name: stage.name, order: stage.order, role: stage.role || 'work' as const, routing: normalizeRoutingConfig(stage.routing) })), reviews)
  if (examSession) context.examSession = examSession
  const subject = renderMergeFields(template.subject, context, { optionLabels, libraries })
  const body = renderMergeFields(template.bodyHtml, context, { mode: 'html', optionLabels, libraries })
  if (!subject.text.trim() || !body.text.trim() || [subject, body].some(result => result.unresolved.length || result.unknownFormats.length || result.unknownLibraries.length)) throw new Error('Template has empty content or unresolved merge fields, formats, or libraries')
  return { subject: subject.text, bodyHtml: body.text }
}

export async function previewEditingReminders(input: ReminderInput) {
  const template = await MessageTemplateModel.findById(input.templateId).lean()
  if (!template) throw new Error('Message template not found')
  const snapshot: ReminderSnapshot = { subject: template.subject, bodyHtml: template.bodyHtml, recipients: [] }
  const previews: Array<{ submissionId: string, subject: string, bodyHtml: string }> = []
  for (const submissionId of input.submissionIds) {
    const outstanding = await EditingReminderModel.findOne({ cycleId: input.cycleId, submissionId, status: { $in: ['pending', 'sending', 'uncertain', 'audit_failed'] } }).select('status').lean()
    if (outstanding) throw new Error('A reminder is pending or requires delivery/audit review; inspect Jobs and Submittable before sending again')
    const submission = await SubmissionModel.findOne({ cycleId: input.cycleId, submissionId, status: { $not: /^withdrawn$/i } }).select('applicationId').lean()
    if (!submission) throw new Error('A selected submission is unavailable or withdrawn')
    const application = await ApplicationModel.findOne({ _id: submission.applicationId, cycleId: input.cycleId }).select('initialFormId').lean()
    if (!application?.initialFormId) throw new Error('Initial application form is not configured')
    const entries = await FormEntryModel.find({ cycleId: input.cycleId, applicationId: submission.applicationId, submissionId, formId: application.initialFormId, formType: 'initial' }).select('entryId editingState editingCheckedAt').lean()
    if (entries.length !== 1 || entries[0]?.editingState !== 'open' || !entries[0].editingCheckedAt) throw new Error('A selected initial application is not confirmed open or has ambiguous entries; refresh extraction')
    const rendered = await renderReminder(input.cycleId, submissionId, template)
    snapshot.recipients.push({ submissionId, entryId: entries[0].entryId, formId: application.initialFormId, digest: reminderDigest(rendered) })
    previews.push({ submissionId, ...rendered })
  }
  return { snapshot, previews, digest: reminderDigest({ input, snapshot }) }
}

export async function runEditingReminders(job: HydratedDocument<Job>, options: { setProgress: (update: Partial<JobProgress>) => Promise<void>, submittable?: SubmittableClientConfig }) {
  const snapshot = job.payload.reminder as ReminderSnapshot | undefined
  if (!snapshot?.recipients?.length || !job.executionKey) throw new Error('Reminder snapshot is missing')
  for (const [index, recipient] of snapshot.recipients.entries()) {
    await options.setProgress({ phase: 'reminders', total: snapshot.recipients.length, processed: index, message: 'Checking and sending confirmed reminders' })
    const filter = { requestKey: job.executionKey, submissionId: recipient.submissionId }
    const claim = await EditingReminderModel.findOneAndUpdate({ ...filter, status: 'pending' }, { $set: { status: 'sending' } }, { returnDocument: 'after' })
    if (!claim) continue
    let sendStarted = false
    let sent = false
    try {
      const [entry, submission] = await Promise.all([
        fetchEntryEditingMetadata(recipient.entryId, options.submittable), fetchSubmission(recipient.submissionId, options.submittable)
      ])
      if (entry.entryId !== recipient.entryId || entry.formId !== recipient.formId || entry.submissionId !== recipient.submissionId || submission.submissionId !== recipient.submissionId || !submission.status) throw new Error('Live source identity or status could not be verified')
      if (/^withdrawn$/i.test(submission.status) || editingState(entry.status) === 'closed') {
        await EditingReminderModel.updateOne(filter, { $set: { status: 'skipped', error: 'Editing closed or submission withdrawn before send' } })
        continue
      }
      if (editingState(entry.status) !== 'open') throw new Error('Live editing state is unknown')
      const rendered = await renderReminder(job.cycleId, recipient.submissionId, snapshot)
      if (reminderDigest(rendered) !== recipient.digest) throw new Error('Personalized content changed since preview; preview again')
      sendStarted = true
      await sendSubmissionMessage({ submissionIds: [recipient.submissionId], subject: rendered.subject, body: rendered.bodyHtml }, options.submittable)
      sent = true
      await EditingReminderModel.updateOne(filter, { $set: { status: 'audit_failed', sentAt: new Date(), error: 'Sent; disclosure audit not yet confirmed' } })
      await recordDisclosure({ actor: job.createdBy, action: 'applicant_message_sent', entityType: 'submission', entityId: recipient.submissionId, detail: { subject: rendered.subject, editingReminder: true, jobId: String(job._id) } })
      await EditingReminderModel.updateOne(filter, { $set: { status: 'sent' }, $unset: { error: 1 } })
    } catch {
      await EditingReminderModel.updateOne(filter, { $set: { status: sent ? 'audit_failed' : sendStarted ? 'uncertain' : 'failed', error: sent ? 'Message sent; audit persistence requires operator review. Do not resend.' : sendStarted ? 'Delivery uncertain; review in Submittable before sending another reminder.' : 'Source verification or rendering failed; nothing sent. Refresh and preview again.' } })
    }
  }
  const attempts = await EditingReminderModel.find({ requestKey: job.executionKey }).select('submissionId status error sentAt').lean()
  const outcomes = attempts.map(attempt => ({ submissionId: attempt.submissionId, status: attempt.status === 'sending' ? 'uncertain' : attempt.status, error: attempt.status === 'sending' ? 'Interrupted send; review in Submittable. Do not automatically resend.' : attempt.error, sentAt: attempt.sentAt }))
  await options.setProgress({ phase: 'completed', total: snapshot.recipients.length, processed: snapshot.recipients.length, percent: 100, message: 'Reminder processing finished; review recipient results' })
  return { outcomes, sent: outcomes.filter(row => row.status === 'sent' || row.status === 'audit_failed').length }
}
