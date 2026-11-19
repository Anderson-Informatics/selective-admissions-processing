import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ find: vi.fn(), label: vi.fn(), build: vi.fn(), audit: vi.fn() }))
vi.mock('../../../models/Submission', () => ({ SubmissionModel: { find: mocks.find } }))
vi.mock('../../../utils/gpa', () => ({ resolveOptInLabelId: mocks.label }))
vi.mock('../../../utils/optInExport', () => ({ buildOptInSchoolExport: mocks.build }))
vi.mock('../../../utils/disclosureAudit', () => ({ recordDisclosure: mocks.audit }))
let handler: (event: unknown) => Promise<unknown>
let query: Record<string, unknown>

beforeAll(async () => {
  vi.stubGlobal('defineEventHandler', (fn: typeof handler) => fn)
  handler = (await import('./export.get')).default as typeof handler
})
beforeEach(() => {
  vi.resetAllMocks()
  query = { cycleId: 'cycle-1', page: '2', search: 'ignored' }
  vi.stubGlobal('requireAuth', vi.fn().mockResolvedValue({ email: 'admin@example.com' }))
  vi.stubGlobal('connectDb', vi.fn())
  vi.stubGlobal('getQuery', () => query)
  vi.stubGlobal('createError', (error: unknown) => error)
  vi.stubGlobal('setResponseHeader', vi.fn())
  mocks.label.mockResolvedValue('opt-in')
  mocks.find.mockReturnValue({ select: () => ({ lean: async () => [{ submissionIdInt: 101, mappedFields: {} }] }) })
  mocks.build.mockResolvedValue({ content: Buffer.from('zip'), rows: 1, schools: 1 })
})

describe('Opt-In export endpoint', () => {
  it('exports the whole cycle with label and withdrawn constraints and records disclosure', async () => {
    expect(await handler({})).toEqual(Buffer.from('zip'))
    expect(mocks.find).toHaveBeenCalledWith({ cycleId: 'cycle-1', labelIds: 'opt-in', status: { $not: /^withdrawn$/i } })
    expect(mocks.audit).toHaveBeenCalledWith({ actor: 'admin@example.com', action: 'pii_export', entityType: 'opt_in_school_files', entityId: 'cycle-1', detail: { rows: 1, schools: 1 } })
    expect(setResponseHeader).toHaveBeenCalledWith({}, 'Cache-Control', 'no-store')
  })
  it('does not return a file if the disclosure audit fails', async () => {
    mocks.audit.mockRejectedValue(new Error('Audit unavailable'))
    await expect(handler({})).rejects.toThrow('Audit unavailable')
    expect(setResponseHeader).not.toHaveBeenCalled()
  })
  it('requires authentication before querying student data', async () => {
    vi.mocked(requireAuth).mockRejectedValue(new Error('Unauthorized'))
    await expect(handler({})).rejects.toThrow('Unauthorized')
    expect(mocks.find).not.toHaveBeenCalled()
  })
  it('requires a cycle and resolvable label', async () => {
    query = {}
    await expect(handler({})).rejects.toMatchObject({ statusCode: 400 })
    query = { cycleId: 'cycle-1' }
    mocks.label.mockResolvedValue(undefined)
    await expect(handler({})).rejects.toMatchObject({ statusCode: 409 })
    expect(mocks.find).not.toHaveBeenCalled()
  })
  it('rejects empty exports and missing numeric IDs', async () => {
    mocks.find.mockReturnValueOnce({ select: () => ({ lean: async () => [] }) })
    await expect(handler({})).rejects.toMatchObject({ statusCode: 404 })
    mocks.find.mockReturnValueOnce({ select: () => ({ lean: async () => [{ mappedFields: {} }] }) })
    await expect(handler({})).rejects.toMatchObject({ statusCode: 409 })
    expect(mocks.build).not.toHaveBeenCalled()
  })
})
