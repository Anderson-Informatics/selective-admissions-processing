import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HydratedDocument } from 'mongoose'
import type { Job } from '../models/Job'
import { ApplicationModel } from '../models/Application'
import { FormEntryModel } from '../models/FormEntry'
import { SubmissionModel } from '../models/Submission'
import { MessageTemplateModel } from '../models/MessageTemplate'
import { EditingReminderModel } from '../models/EditingReminder'
import { ReviewModel } from '../models/Review'
import { ReviewStageModel } from '../models/ReviewStage'
import { previewEditingReminders, reminderDigest, runEditingReminders, validateReminderInput } from './editingReminders'
import { renderMergeFields } from './routingActions'
import { fetchEntryEditingMetadata, fetchSubmission, sendSubmissionMessage } from './submittable'
import { recordDisclosure } from './disclosureAudit'

vi.mock('./routingActions', () => ({ renderMergeFields: vi.fn() }))
vi.mock('./routingRun', () => ({ buildRoutingContext: vi.fn(() => ({})), loadExamSessionContext: vi.fn(), loadListOptionLabels: vi.fn(), loadResponseLibraries: vi.fn() }))
vi.mock('./submittable', () => ({ fetchEntryEditingMetadata: vi.fn(), fetchSubmission: vi.fn(), sendSubmissionMessage: vi.fn() }))
vi.mock('./disclosureAudit', () => ({ recordDisclosure: vi.fn() }))

const cycleId = '111111111111111111111111'
const templateId = '222222222222222222222222'
const submissionId = '00000000-0000-0000-0000-000000000001'
const input = { cycleId, templateId, submissionIds: [submissionId] }
const rendered = { subject: 'Hello', bodyHtml: '<p>Update documents</p>' }
const snapshot = { ...rendered, recipients: [{ submissionId, entryId: 'entry', formId: 'form', digest: reminderDigest(rendered) }] }
const job = { _id: 'job', cycleId, createdBy: 'staff', executionKey: 'request', payload: { reminder: snapshot } } as unknown as HydratedDocument<Job>
const setProgress = vi.fn()
const lean = (value: unknown) => ({ lean: vi.fn().mockResolvedValue(value) })
const select = (value: unknown) => ({ select: vi.fn(() => lean(value)), ...lean(value) })
let state: { submissionId: string, status: string, error?: string, sentAt?: Date }

beforeEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  state = { submissionId, status: 'pending' }
  vi.spyOn(SubmissionModel, 'findOne').mockReturnValue(select({ applicationId: 'application', submissionId, cycleId }) as never)
  vi.spyOn(ApplicationModel, 'findOne').mockReturnValue(select({ initialFormId: 'form' }) as never)
  vi.spyOn(FormEntryModel, 'find').mockReturnValue(select([{ entryId: 'entry', editingState: 'open', editingCheckedAt: new Date() }]) as never)
  vi.spyOn(MessageTemplateModel, 'findById').mockReturnValue(lean(rendered) as never)
  vi.spyOn(ReviewModel, 'find').mockReturnValue(lean([]) as never)
  vi.spyOn(ReviewStageModel, 'find').mockReturnValue(lean([]) as never)
  vi.mocked(renderMergeFields).mockImplementation(text => ({ text, unresolved: [], unknownFormats: [], unknownLibraries: [] }))
  vi.mocked(fetchEntryEditingMetadata).mockResolvedValue({ entryId: 'entry', submissionId, formId: 'form', status: 'editable' })
  vi.mocked(fetchSubmission).mockResolvedValue({ submissionId, status: 'active' })
  vi.mocked(sendSubmissionMessage).mockResolvedValue(undefined)
  vi.mocked(recordDisclosure).mockResolvedValue(undefined)
  vi.spyOn(EditingReminderModel, 'findOne').mockReturnValue(select(null) as never)
  vi.spyOn(EditingReminderModel, 'findOneAndUpdate').mockImplementation((async (filter: { status: string }) => {
    if (state.status !== filter.status) return null
    state.status = 'sending'
    return state
  }) as never)
  vi.spyOn(EditingReminderModel, 'updateOne').mockImplementation((async (_filter: unknown, update: { $set?: object, $unset?: { error?: number } }) => {
    Object.assign(state, update.$set)
    if (update.$unset?.error) delete state.error
    return {}
  }) as never)
  vi.spyOn(EditingReminderModel, 'find').mockImplementation(() => select([state]) as never)
})

describe('reminder validation and preview', () => {
  it('deduplicates recipients and rejects invalid or oversized requests', () => {
    expect(validateReminderInput({ ...input, submissionIds: [submissionId, submissionId] })).toEqual(input)
    for (const value of [null, {}, { ...input, cycleId: {} }, { ...input, submissionIds: [] }, { ...input, submissionIds: ['bad'] }, { ...input, submissionIds: Array(101).fill(submissionId) }]) expect(() => validateReminderInput(value)).toThrow()
  })

  it('previews the configured initial form and binds confirmation to content', async () => {
    const result = await previewEditingReminders(input)
    expect(result.previews).toEqual([{ submissionId, ...rendered }])
    expect(result.snapshot).toEqual(snapshot)
    expect(result.digest).toBe(reminderDigest({ input, snapshot }))
    expect(FormEntryModel.find).toHaveBeenCalledWith(expect.objectContaining({ cycleId, submissionId, applicationId: 'application', formType: 'initial', formId: 'form' }))
    expect(sendSubmissionMessage).not.toHaveBeenCalled()
  })

  it.each([[], [{ editingState: 'closed' }], [{ editingState: 'open' }], [{ editingState: 'open' }, { editingState: 'open' }]].map(entries => ({ entries })))('rejects missing, closed, unchecked, or ambiguous initial entries $entries', async ({ entries }) => {
    vi.spyOn(FormEntryModel, 'find').mockReturnValue(select(entries) as never)
    await expect(previewEditingReminders(input)).rejects.toThrow()
  })

  it.each(['pending', 'sending', 'uncertain', 'audit_failed'])('blocks another preview when a prior reminder is %s', async (status) => {
    vi.spyOn(EditingReminderModel, 'findOne').mockReturnValue(select({ status }) as never)
    await expect(previewEditingReminders(input)).rejects.toThrow('requires delivery/audit review')
    expect(sendSubmissionMessage).not.toHaveBeenCalled()
  })

  it('blocks unresolved merge fields', async () => {
    vi.mocked(renderMergeFields).mockReturnValue({ text: '{{missing}}', unresolved: ['missing'], unknownFormats: [], unknownLibraries: [] })
    await expect(previewEditingReminders(input)).rejects.toThrow('unresolved')
  })

  it('rejects cross-cycle or withdrawn submissions', async () => {
    vi.spyOn(SubmissionModel, 'findOne').mockReturnValue(select(null) as never)
    await expect(previewEditingReminders(input)).rejects.toThrow('unavailable')
  })
})

describe('reminder worker safety', () => {
  it('sends once, audits, and does not resend on replay', async () => {
    expect(await runEditingReminders(job, { setProgress })).toMatchObject({ sent: 1, outcomes: [{ submissionId, status: 'sent' }] })
    await runEditingReminders(job, { setProgress })
    expect(sendSubmissionMessage).toHaveBeenCalledTimes(1)
    expect(recordDisclosure).toHaveBeenCalledWith(expect.objectContaining({ actor: 'staff', action: 'applicant_message_sent', entityId: submissionId }))
  })

  it('atomic claims prevent concurrent workers from sending twice', async () => {
    await Promise.all([runEditingReminders(job, { setProgress }), runEditingReminders(job, { setProgress })])
    expect(sendSubmissionMessage).toHaveBeenCalledTimes(1)
  })

  it.each(['closed', 'withdrawn'])('skips a request that became %s after preview', async (reason) => {
    if (reason === 'closed') vi.mocked(fetchEntryEditingMetadata).mockResolvedValue({ entryId: 'entry', submissionId, formId: 'form', status: 'complete' })
    else vi.mocked(fetchSubmission).mockResolvedValue({ submissionId, status: 'Withdrawn' })
    expect(await runEditingReminders(job, { setProgress })).toMatchObject({ sent: 0, outcomes: [{ status: 'skipped' }] })
    expect(sendSubmissionMessage).not.toHaveBeenCalled()
  })

  it('fails safely when source status is unavailable', async () => {
    vi.mocked(fetchEntryEditingMetadata).mockRejectedValue(new Error('network'))
    expect(await runEditingReminders(job, { setProgress })).toMatchObject({ sent: 0, outcomes: [{ status: 'failed' }] })
    expect(sendSubmissionMessage).not.toHaveBeenCalled()
  })

  it('fails safely when source identity or editing state is unknown', async () => {
    vi.mocked(fetchEntryEditingMetadata).mockResolvedValue({ entryId: 'different', status: 'editable' })
    expect(await runEditingReminders(job, { setProgress })).toMatchObject({ outcomes: [{ status: 'failed' }] })
    expect(sendSubmissionMessage).not.toHaveBeenCalled()
  })

  it('requires a new preview if personalized content changed', async () => {
    vi.mocked(renderMergeFields).mockReturnValue({ text: 'changed', unresolved: [], unknownFormats: [], unknownLibraries: [] })
    expect(await runEditingReminders(job, { setProgress })).toMatchObject({ outcomes: [{ status: 'failed' }] })
    expect(sendSubmissionMessage).not.toHaveBeenCalled()
  })

  it('never automatically retries ambiguous delivery', async () => {
    vi.mocked(sendSubmissionMessage).mockRejectedValue(new Error('timeout'))
    expect(await runEditingReminders(job, { setProgress })).toMatchObject({ sent: 0, outcomes: [{ status: 'uncertain' }] })
    await runEditingReminders(job, { setProgress })
    expect(sendSubmissionMessage).toHaveBeenCalledTimes(1)
  })

  it('records successful delivery separately from a disclosure audit failure', async () => {
    vi.mocked(recordDisclosure).mockRejectedValue(new Error('audit unavailable'))
    expect(await runEditingReminders(job, { setProgress })).toMatchObject({ sent: 1, outcomes: [{ status: 'audit_failed' }] })
    await runEditingReminders(job, { setProgress })
    expect(sendSubmissionMessage).toHaveBeenCalledTimes(1)
  })

  it('continues a bulk job after one recipient has uncertain delivery', async () => {
    const secondId = '00000000-0000-0000-0000-000000000002'
    const states = new Map([submissionId, secondId].map(id => [id, { submissionId: id, status: 'pending' }]))
    vi.spyOn(EditingReminderModel, 'findOneAndUpdate').mockImplementation((async (filter: { submissionId: string, status: string }) => {
      const row = states.get(filter.submissionId)!
      if (row.status !== filter.status) return null
      row.status = 'sending'
      return row
    }) as never)
    vi.spyOn(EditingReminderModel, 'updateOne').mockImplementation((async (filter: { submissionId: string }, update: { $set: object }) => {
      Object.assign(states.get(filter.submissionId)!, update.$set)
      return {}
    }) as never)
    vi.spyOn(EditingReminderModel, 'find').mockImplementation(() => select([...states.values()]) as never)
    vi.mocked(fetchEntryEditingMetadata).mockImplementation(async entryId => ({ entryId, formId: 'form', submissionId: entryId === 'entry' ? submissionId : secondId, status: 'editable' }))
    vi.mocked(fetchSubmission).mockImplementation(async id => ({ submissionId: id, status: 'active' }))
    vi.mocked(sendSubmissionMessage).mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(undefined)
    const bulk = { ...job, payload: { reminder: { ...snapshot, recipients: [...snapshot.recipients, { ...snapshot.recipients[0]!, submissionId: secondId, entryId: 'entry-2' }] } } } as HydratedDocument<Job>
    expect(await runEditingReminders(bulk, { setProgress })).toMatchObject({ sent: 1, outcomes: [{ submissionId, status: 'uncertain' }, { submissionId: secondId, status: 'sent' }] })
    expect(sendSubmissionMessage).toHaveBeenCalledTimes(2)
  })

  it('reports an interrupted claimed send as uncertain rather than retrying', async () => {
    state.status = 'sending'
    expect(await runEditingReminders(job, { setProgress })).toMatchObject({ sent: 0, outcomes: [{ status: 'uncertain' }] })
    expect(sendSubmissionMessage).not.toHaveBeenCalled()
  })
})
