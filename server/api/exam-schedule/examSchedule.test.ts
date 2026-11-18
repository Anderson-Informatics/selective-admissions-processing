import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ load: vi.fn(), compute: vi.fn(), resolve: vi.fn(), createJob: vi.fn() }))
vi.mock('~~/server/utils/examSchedulingRun', () => ({ loadExamScheduleContext: mocks.load, computeSessionAssignment: mocks.compute, resolveGroupLabelIds: mocks.resolve }))
vi.mock('~~/server/utils/jobs', () => ({ createJob: mocks.createJob }))
vi.mock('~~/server/utils/examScheduling', async () => import('../../utils/examScheduling'))

type Handler = (event: unknown) => Promise<unknown>
let finalize: Handler
let preview: Handler
const member = { submissionId: 'student', fullName: 'Student Name', submissionIdInt: 123, completionBlocked: true, missingRequiredReviews: ['IEP Review'] }

beforeAll(async () => {
  vi.stubGlobal('defineEventHandler', (handler: Handler) => handler)
  finalize = (await import('./finalize.post')).default as Handler
  preview = (await import('./preview.post')).default as Handler
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('requireAuth', vi.fn(async () => ({ email: 'admin' })))
  vi.stubGlobal('connectDb', vi.fn())
  vi.stubGlobal('readBody', vi.fn(async () => ({ cycleId: 'cycle', sessionLabelId: 'session' })))
  vi.stubGlobal('createError', (input: object) => Object.assign(new Error('request failed'), input))
  mocks.load.mockResolvedValue({ config: { messageTemplateId: 'template', examLabelTemplate: 'Exam - {letter}', groups: {}, colorLabels: {} }, labels: [{ externalId: 'session', name: 'HSPT Nov 21' }] })
  mocks.compute.mockResolvedValue({ groups: { RED: [] }, assignments: {}, diagnostics: [], unassignedIds: ['student'], members: { student: member } })
  mocks.resolve.mockReturnValue({ missing: [] })
  mocks.createJob.mockResolvedValue({ _id: 'job' })
})
afterEach(() => vi.unstubAllGlobals())

describe('exam schedule routes', () => {
  it('rejects unassigned blockers before enqueueing', async () => {
    await expect(finalize({})).rejects.toMatchObject({ statusCode: 409, data: { blockers: [member] } })
    expect(mocks.createJob).not.toHaveBeenCalled()
  })

  it('returns unassigned blockers and non-blocking actual-review warnings separately', async () => {
    await expect(preview({})).resolves.toMatchObject({ blockers: [member], reviewWarnings: [member], assignedCount: 0, unassignedCount: 1, members: { student: member } })
  })

  it('enqueues when only actual-review warnings remain', async () => {
    mocks.compute.mockResolvedValue({ groups: { IEP504: ['student'] }, assignments: { student: 'IEP504' }, diagnostics: [], unassignedIds: [], members: { student: { ...member, completionBlocked: false } } })
    await expect(finalize({})).resolves.toEqual({ jobId: 'job', assigned: 1 })
    expect(mocks.createJob).toHaveBeenCalledWith('exam_schedule_finalize', 'cycle', 'admin', expect.objectContaining({ assignments: { student: 'IEP504' } }))
  })
})
