import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { JobScheduleModel } from '../../models/JobSchedule'

vi.mock('../../models/JobSchedule', () => ({ JobScheduleModel: { create: vi.fn(), findById: vi.fn(), findOneAndUpdate: vi.fn() } }))
type Handler = (event: unknown) => Promise<unknown>
let create: Handler
let update: Handler
let body: Record<string, unknown>
const id = '507f1f77bcf86cd799439011'
beforeAll(async () => {
  vi.stubGlobal('defineEventHandler', (handler: Handler) => handler)
  create = (await import('./index.post')).default as Handler
  update = (await import('./[id].put')).default as Handler
})
beforeEach(() => {
  vi.clearAllMocks()
  body = { name: 'Morning', time: '06:00', enabled: false, steps: ['submission_extraction', 'form_response_mapping'], dryRun: true, acknowledged: false, revision: 0 }
  vi.stubGlobal('requireAuth', vi.fn(async () => ({ email: 'actor' })))
  vi.stubGlobal('connectDb', vi.fn())
  vi.stubGlobal('readBody', vi.fn(async () => body))
  vi.stubGlobal('getRouterParam', vi.fn(() => id))
  vi.stubGlobal('createError', (input: object) => Object.assign(new Error('request failed'), input))
  vi.mocked(JobScheduleModel.create).mockResolvedValue({ _id: id } as never)
  vi.mocked(JobScheduleModel.findById).mockReturnValue({ lean: async () => ({ ...body, enabled: true }) } as never)
  vi.mocked(JobScheduleModel.findOneAndUpdate).mockResolvedValue({ _id: id } as never)
})
afterEach(() => vi.unstubAllGlobals())
describe('schedule APIs', () => {
  it('creates an actor-owned prospective schedule', async () => {
    await create({})
    expect(JobScheduleModel.create).toHaveBeenCalledWith(expect.objectContaining({ createdBy: 'actor', updatedBy: 'actor', eligibleAfter: expect.any(Date) }))
  })
  it.each([['form_response_mapping'], ['run_routing'], ['score_compilation'], ['hspt_upload_commit'], ['run_validation', 'catchment_lookup']])('rejects invalid chain %j', async (...steps) => {
    body.steps = steps
    await expect(create({})).rejects.toMatchObject({ statusCode: 400 })
    expect(JobScheduleModel.create).not.toHaveBeenCalled()
  })
  it('rejects unknown fields and missing external acknowledgement', async () => {
    body.payload = {}
    await expect(create({})).rejects.toMatchObject({ statusCode: 400 })
    delete body.payload
    Object.assign(body, { steps: ['essay_begin_scoring'], enabled: true })
    await expect(create({})).rejects.toMatchObject({ statusCode: 400 })
  })
  it('requires authentication before reading bodies or touching DB', async () => {
    vi.stubGlobal('requireAuth', vi.fn(async () => {
      throw Object.assign(new Error('Unauthorized'), { statusCode: 401 })
    }))
    await expect(create({})).rejects.toMatchObject({ statusCode: 401 })
    await expect(update({})).rejects.toMatchObject({ statusCode: 401 })
    expect(JobScheduleModel.create).not.toHaveBeenCalled()
  })
  it('uses revision checks and reports concurrent edits', async () => {
    vi.mocked(JobScheduleModel.findOneAndUpdate).mockResolvedValue(null)
    await expect(update({})).rejects.toMatchObject({ statusCode: 409 })
    expect(JobScheduleModel.findOneAndUpdate).toHaveBeenCalledWith({ _id: id, revision: 0 }, expect.objectContaining({ $inc: { revision: 1 } }), { returnDocument: 'after' })
  })
})
