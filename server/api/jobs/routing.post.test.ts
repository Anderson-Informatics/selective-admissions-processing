import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { JobModel } from '../../models/Job'

vi.mock('../../models/Job', () => ({ ESSAY_JOB_TYPES: [], JobModel: { exists: vi.fn(), init: vi.fn(), create: vi.fn() } }))

type Handler = (event: unknown) => Promise<unknown>
let handler: Handler
let payload: Record<string, unknown>

beforeAll(async () => {
  vi.stubGlobal('defineEventHandler', (value: Handler) => value)
  handler = (await import('./index.post')).default as Handler
})

beforeEach(() => {
  vi.clearAllMocks()
  payload = { scope: 'all', applicationId: 'app', dryRun: true }
  vi.stubGlobal('connectDb', vi.fn())
  vi.stubGlobal('requireAuth', vi.fn(async () => ({ email: 'actor' })))
  vi.stubGlobal('readBody', vi.fn(async () => ({ type: 'run_routing', cycleId: 'cycle', payload })))
  vi.stubGlobal('createError', (input: object) => Object.assign(new Error('request failed'), input))
  vi.stubGlobal('useRuntimeConfig', () => ({ public: { appUrl: 'http://localhost:3000' } }))
  vi.stubGlobal('fetch', vi.fn())
  vi.mocked(JobModel.exists).mockResolvedValue(null)
  vi.mocked(JobModel.create).mockResolvedValue({ toObject: () => ({ _id: 'job' }) } as never)
})

afterEach(() => vi.unstubAllGlobals())

describe('routing job requests', () => {
  it('queues validated scope with a cycle lock and strips internal state', async () => {
    payload.currentStageId = 'stage-1'
    payload.routingInitialized = true
    await expect(handler({})).resolves.toEqual({ _id: 'job' })
    expect(JobModel.init).toHaveBeenCalled()
    expect(JobModel.create).toHaveBeenCalledWith(expect.objectContaining({ routingLock: 'cycle', payload: expect.objectContaining({ scope: 'all', dryRun: true, currentStageId: 'stage-1' }) }))
    expect(vi.mocked(JobModel.create).mock.calls[0]![0]).not.toHaveProperty('payload.routingInitialized')
  })

  it.each([{ currentStageId: [] }, { scope: 'invalid' }, { limit: 0 }, { limit: 5001 }, { limit: 1.5 }, { dryRun: 'false' }, { labelId: [] }, { excludeSubmissionIds: [1] }])('rejects invalid settings %j', async (invalid) => {
    Object.assign(payload, invalid)
    await expect(handler({})).rejects.toMatchObject({ statusCode: 400 })
    expect(JobModel.create).not.toHaveBeenCalled()
  })

  it('rejects active overlapping jobs', async () => {
    vi.mocked(JobModel.exists).mockResolvedValue({ _id: 'other' } as never)
    await expect(handler({})).rejects.toMatchObject({ statusCode: 409 })
  })

  it('maps an atomic cycle-lock collision to a conflict response', async () => {
    vi.mocked(JobModel.create).mockRejectedValue({ code: 11000 })
    await expect(handler({})).rejects.toMatchObject({ statusCode: 409 })
  })
})
