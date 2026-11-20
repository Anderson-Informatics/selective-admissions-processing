import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SubmissionModel } from '../../models/Submission'
import { JobModel } from '../../models/Job'
import { EditingReminderModel } from '../../models/EditingReminder'

const mocks = vi.hoisted(() => ({ preview: vi.fn(), validate: vi.fn(), digest: vi.fn(() => 'key') }))
vi.mock('../../utils/editingReminders', () => ({ previewEditingReminders: mocks.preview, validateReminderInput: mocks.validate, reminderDigest: mocks.digest }))

type Handler = (event: unknown) => Promise<unknown>
let list: Handler
let preview: Handler
let queue: Handler
let body: Record<string, unknown>
let query: Record<string, string>
const input = { cycleId: 'cycle', templateId: 'template', submissionIds: ['submission'] }
const snapshot = { subject: 'Subject', bodyHtml: 'Body', recipients: [{ submissionId: 'submission', entryId: 'entry', formId: 'form', digest: 'content-hash' }] }
const job = { _id: 'job', cycleId: 'cycle', createdBy: 'staff', payload: { reminder: snapshot } }

beforeAll(async () => {
  vi.stubGlobal('defineEventHandler', (handler: Handler) => handler)
  list = (await import('./editing.get')).default as Handler
  preview = (await import('./editing/preview.post')).default as Handler
  queue = (await import('./editing/reminders.post')).default as Handler
})
beforeEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  vi.stubGlobal('requireAuth', vi.fn(async () => ({ email: 'staff' })))
  vi.stubGlobal('connectDb', vi.fn())
  vi.stubGlobal('createError', (value: object) => Object.assign(new Error('request failed'), value))
  vi.stubGlobal('readBody', vi.fn(async () => body))
  vi.stubGlobal('getQuery', vi.fn(() => query))
  query = { cycleId: 'cycle' }
  body = { ...input, digest: 'a'.repeat(64), requestKey: '00000000-0000-0000-0000-000000000001', confirmed: true }
  mocks.validate.mockReturnValue(input)
  mocks.preview.mockResolvedValue({ previews: [], snapshot, digest: 'a'.repeat(64) })
  vi.spyOn(SubmissionModel, 'aggregate').mockResolvedValue([{ rows: [{ submissionId: 'submission' }], count: [{ total: 30 }] }])
  vi.spyOn(JobModel, 'init').mockResolvedValue(undefined as never)
  vi.spyOn(EditingReminderModel, 'init').mockResolvedValue(undefined as never)
  vi.spyOn(JobModel, 'findOne').mockResolvedValue(null)
  vi.spyOn(JobModel, 'findOneAndUpdate').mockResolvedValue(job as never)
  vi.spyOn(JobModel, 'updateOne').mockResolvedValue({} as never)
  vi.spyOn(EditingReminderModel, 'bulkWrite').mockResolvedValue({} as never)
})
afterEach(() => vi.unstubAllGlobals())

describe('editing queue route', () => {
  it('requires auth for every endpoint', async () => {
    vi.stubGlobal('requireAuth', vi.fn().mockRejectedValue(new Error('unauthorized')))
    for (const handler of [list, preview, queue]) await expect(handler({})).rejects.toThrow('unauthorized')
    expect(SubmissionModel.aggregate).not.toHaveBeenCalled()
    expect(JobModel.findOneAndUpdate).not.toHaveBeenCalled()
  })

  it('requires a cycle', async () => {
    query = {}
    await expect(list({})).rejects.toMatchObject({ statusCode: 400 })
  })

  it('filters before pagination and keeps count independent of page', async () => {
    query = { cycleId: 'cycle', applicationId: 'app', stageId: 'stage', labelId: 'label', q: 'A.*', minDays: '7', page: '2' }
    await expect(list({})).resolves.toMatchObject({ total: 30, page: 2, limit: 25 })
    const pipeline = vi.mocked(SubmissionModel.aggregate).mock.calls[0]![0]!
    expect(pipeline[0]).toEqual({ $match: expect.objectContaining({ cycleId: 'cycle', applicationId: 'app', currentStageId: 'stage', labelIds: 'label', status: { $not: /^withdrawn$/i } }) })
    expect(JSON.stringify(pipeline)).toContain('A\\\\.\\\\*')
    expect(pipeline).toContainEqual({ $match: { 'initialEntries.0': { $exists: true }, 'initialEntries.1': { $exists: false } } })
    expect(pipeline).toContainEqual({ $match: { 'editing.editingState': 'open', 'editing.editingCheckedAt': { $type: 'date' } } })
    expect(pipeline).toContainEqual({ $match: { 'editing.openedForEditingAt': { $lte: expect.any(Date) } } })
    const facet = pipeline.at(-1) as { $facet: { count: unknown[], rows: unknown[] } }
    expect(facet.$facet.count).toEqual([{ $count: 'total' }])
    expect(facet.$facet.rows).toContainEqual({ $sort: { 'missingOpeningDate': 1, 'editing.openedForEditingAt': 1, 'submissionId': 1 } })
    expect(facet.$facet.rows).toContainEqual({ $skip: 25 })
    expect(facet.$facet.rows).toContainEqual({ $limit: 25 })
    expect(JSON.stringify(pipeline)).toContain('initial')
    expect(JSON.stringify(pipeline)).toContain('$$formId')
  })

  it('returns empty results and clamps malformed page numbers', async () => {
    query.page = '-8'
    vi.spyOn(SubmissionModel, 'aggregate').mockResolvedValue([{ rows: [], count: [] }])
    await expect(list({})).resolves.toEqual({ submissions: [], total: 0, page: 1, limit: 25 })
  })
})

describe('reminder preview and queue routes', () => {
  it('rejects invalid preview requests', async () => {
    mocks.validate.mockImplementationOnce(() => {
      throw new Error('invalid')
    })
    await expect(preview({})).rejects.toMatchObject({ statusCode: 400 })
  })

  it('returns preview content but never the internal snapshot', async () => {
    await expect(preview({})).resolves.toEqual({ previews: [], digest: 'a'.repeat(64) })
  })

  it('requires explicit confirmation', async () => {
    body.confirmed = false
    await expect(queue({})).rejects.toMatchObject({ statusCode: 400 })
    expect(JobModel.findOneAndUpdate).not.toHaveBeenCalled()
  })

  it('rejects changed personalized content', async () => {
    mocks.preview.mockResolvedValueOnce({ digest: 'different' })
    await expect(queue({})).rejects.toMatchObject({ statusCode: 409 })
    expect(JobModel.findOneAndUpdate).not.toHaveBeenCalled()
  })

  it('creates a waiting job and idempotent attempts before releasing it', async () => {
    await expect(queue({})).resolves.toEqual({ jobId: 'job' })
    expect(JobModel.findOneAndUpdate).toHaveBeenCalledWith({ executionKey: 'editing-reminder:key' }, { $setOnInsert: expect.objectContaining({ status: 'waiting', type: 'editing_reminder_send', payload: { templateId: 'template', reminder: snapshot } }) }, expect.objectContaining({ upsert: true }))
    expect(EditingReminderModel.bulkWrite).toHaveBeenCalledWith([{ updateOne: expect.objectContaining({ filter: { requestKey: 'editing-reminder:key', submissionId: 'submission' }, upsert: true }) }])
    expect(JobModel.updateOne).toHaveBeenCalledWith({ _id: 'job', status: 'waiting' }, { $set: { status: 'pending' } })
  })

  it('recovers the same job on a repeated confirmed request without rerendering or replacing state', async () => {
    vi.spyOn(JobModel, 'findOne').mockResolvedValue(job as never)
    await expect(queue({})).resolves.toEqual({ jobId: 'job' })
    expect(mocks.preview).not.toHaveBeenCalled()
    expect(JobModel.findOneAndUpdate).not.toHaveBeenCalled()
    expect(EditingReminderModel.bulkWrite).toHaveBeenCalledWith([expect.objectContaining({ updateOne: expect.objectContaining({ update: { $setOnInsert: expect.objectContaining({ status: 'pending' }) } }) })])
  })
})
