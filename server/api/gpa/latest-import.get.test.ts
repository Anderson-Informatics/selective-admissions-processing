import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ findOne: vi.fn(), sort: vi.fn(), select: vi.fn(), lean: vi.fn() }))
vi.mock('~~/server/models/Job', () => ({ JobModel: { findOne: mocks.findOne } }))

let handler: (event: unknown) => Promise<unknown>
let query: Record<string, string>

beforeAll(async () => {
  vi.stubGlobal('defineEventHandler', (fn: typeof handler) => fn)
  handler = (await import('./latest-import.get')).default as typeof handler
})

beforeEach(() => {
  vi.clearAllMocks()
  query = { cycleId: 'cycle-1' }
  vi.stubGlobal('connectDb', vi.fn())
  vi.stubGlobal('requireAuth', vi.fn())
  vi.stubGlobal('getQuery', () => query)
  vi.stubGlobal('createError', (error: unknown) => error)
  mocks.findOne.mockReturnValue({ sort: mocks.sort })
  mocks.sort.mockReturnValue({ select: mocks.select })
  mocks.select.mockReturnValue({ lean: mocks.lean })
  mocks.lean.mockResolvedValue(null)
})

describe('GET /api/gpa/latest-import', () => {
  it('queries the latest DPSCD import directly and returns only banner fields', async () => {
    const summary = { status: 'completed', createdAt: '2026-11-18', result: { matched: 10, unmatched: 2, updated: 10 } }
    mocks.lean.mockResolvedValue(summary)
    expect(await handler({})).toEqual(summary)
    expect(mocks.findOne).toHaveBeenCalledWith({ cycleId: 'cycle-1', type: 'dpscd_gpa_import', parentJobId: { $exists: false } })
    expect(mocks.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 })
    expect(mocks.select).toHaveBeenCalledWith('status createdAt result.matched result.unmatched result.updated')
  })

  it('returns null when the cycle has no DPSCD import', async () => {
    expect(await handler({})).toBeNull()
  })

  it('requires a cycle and authentication', async () => {
    query = {}
    await expect(handler({})).rejects.toMatchObject({ statusCode: 400 })
    vi.mocked(requireAuth).mockRejectedValueOnce(new Error('Unauthorized'))
    await expect(handler({})).rejects.toThrow('Unauthorized')
    expect(mocks.findOne).not.toHaveBeenCalled()
  })
})
