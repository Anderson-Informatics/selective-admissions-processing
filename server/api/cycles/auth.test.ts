import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const model = vi.hoisted(() => ({
  find: vi.fn(),
  findOne: vi.fn(),
  findById: vi.fn(),
  findByIdAndDelete: vi.fn(),
  create: vi.fn(),
  updateMany: vi.fn()
}))
vi.mock('~~/server/models/Cycle', () => ({ CycleModel: model }))
vi.mock('~~/server/utils/cycleRounds', () => ({ normalizeCycleRounds: vi.fn(() => []) }))

type Handler = (event: unknown) => Promise<unknown>
let handlers: Handler[]
const routes = ['list', 'get', 'create', 'update', 'delete', 'clone']

beforeAll(async () => {
  vi.stubGlobal('defineEventHandler', (handler: Handler) => handler)
  handlers = (await Promise.all([
    import('./index.get'),
    import('./[id].get'),
    import('./index.post'),
    import('./[id].put'),
    import('./[id].delete'),
    import('./[id]/clone.post')
  ])).map(route => route.default as Handler)
})

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('connectDb', vi.fn())
  vi.stubGlobal('requireAuth', vi.fn().mockRejectedValue(Object.assign(new Error('Unauthorized'), { statusCode: 401 })))
  vi.stubGlobal('getRouterParam', vi.fn(() => 'cycle-1'))
  vi.stubGlobal('readBody', vi.fn(async () => ({ year: '2027-2028', name: 'Next cycle' })))
  vi.stubGlobal('createError', (input: { statusCode: number, statusMessage: string }) => Object.assign(new Error(input.statusMessage), input))
  model.find.mockReturnValue({ sort: vi.fn(async () => []) })
})

afterEach(() => vi.unstubAllGlobals())

describe('cycle API authentication', () => {
  it.each(routes)('rejects unauthenticated %s before accessing data', async (route) => {
    const event = {}
    await expect(handlers[routes.indexOf(route)]!(event)).rejects.toMatchObject({ statusCode: 401 })
    expect(requireAuth).toHaveBeenCalledWith(event)
    expect(connectDb).not.toHaveBeenCalled()
    expect(readBody).not.toHaveBeenCalled()
    for (const method of Object.values(model)) expect(method).not.toHaveBeenCalled()
  })

  it('allows an authenticated list request', async () => {
    vi.mocked(requireAuth).mockResolvedValue({ email: 'admin@example.test' })
    await expect(handlers[0]!({})).resolves.toEqual([])
    expect(connectDb).toHaveBeenCalledOnce()
    expect(model.find).toHaveBeenCalledOnce()
  })
})
