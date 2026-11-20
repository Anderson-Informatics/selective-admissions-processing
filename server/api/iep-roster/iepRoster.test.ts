import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ load: vi.fn(), build: vi.fn(), audit: vi.fn() }))
vi.mock('../../utils/iepRosteringRun', () => ({ loadIepRoster: mocks.load }))
vi.mock('../../utils/iepRosterExport', () => ({ buildIepRosterExport: mocks.build }))
vi.mock('../../utils/disclosureAudit', () => ({ recordDisclosure: mocks.audit }))

let preview: (event: unknown) => Promise<unknown>
let download: (event: unknown) => Promise<unknown>
let query: Record<string, unknown>
const cycleId = '0123456789abcdef01234567'
const rows = [{ submissionId: 's1', submissionIdInt: 100, sessionLabelId: 'day', finalGroup: 'Group A' }, { submissionId: 's2', submissionIdInt: 101, sessionLabelId: 'day2', finalGroup: 'Group B' }]

beforeAll(async () => {
  vi.stubGlobal('defineEventHandler', (handler: typeof preview) => handler)
  preview = (await import('./index.get')).default as typeof preview
  download = (await import('./export.get')).default as typeof download
})
beforeEach(() => {
  vi.resetAllMocks()
  query = { cycleId, sessionLabelId: 'day', format: 'docx' }
  vi.stubGlobal('requireAuth', vi.fn().mockResolvedValue({ email: 'staff@example.com' }))
  vi.stubGlobal('connectDb', vi.fn())
  vi.stubGlobal('getQuery', () => query)
  vi.stubGlobal('createError', (error: unknown) => error)
  vi.stubGlobal('setResponseHeader', vi.fn())
  mocks.load.mockResolvedValue({ sessions: [{ labelId: 'day' }, { labelId: 'day2' }], rows, diagnostics: [], generatedAt: '2026-11-20T10:00:00Z' })
  mocks.build.mockResolvedValue({ content: Buffer.from('file'), contentType: 'type', filename: 'roster.docx' })
})

describe('IEP roster endpoints', () => {
  it.each(['preview', 'download'])('requires authentication before %s reads', async (route) => {
    vi.mocked(requireAuth).mockRejectedValue(new Error('Unauthorized'))
    await expect((route === 'preview' ? preview : download)({})).rejects.toThrow('Unauthorized')
    expect(mocks.load).not.toHaveBeenCalled()
    expect(connectDb).not.toHaveBeenCalled()
  })

  it('lists sessions without exposing all-day rows and previews only the chosen day', async () => {
    query = { cycleId }
    expect(await preview({})).toMatchObject({ rows: [], groups: [] })
    query.sessionLabelId = 'day'
    expect(await preview({})).toMatchObject({ rows: [rows[0]], groups: [{ name: 'Group A', count: 1 }] })
    expect(setResponseHeader).toHaveBeenCalledWith({}, 'Cache-Control', 'no-store')
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('exports only selected rows and records disclosure before attachment headers', async () => {
    expect(await download({})).toEqual(Buffer.from('file'))
    expect(mocks.load).toHaveBeenCalledWith(cycleId)
    expect(mocks.build).toHaveBeenCalledWith([rows[0]], 'docx', false)
    expect(mocks.audit).toHaveBeenCalledWith({ actor: 'staff@example.com', action: 'pii_export', entityType: 'iep_roster', entityId: cycleId, detail: { sessions: ['day'], format: 'docx', scope: 'day', rows: 1, generatedAt: '2026-11-20T10:00:00Z' } })
    expect(setResponseHeader).toHaveBeenCalledWith({}, 'Content-Disposition', 'attachment; filename*=UTF-8\'\'roster.docx')
  })

  it('exports all days only as ZIP', async () => {
    query = { cycleId, scope: 'all', format: 'zip' }
    await download({})
    expect(mocks.build).toHaveBeenCalledWith(rows, 'zip', true)
    query.format = 'docx'
    await expect(download({})).rejects.toMatchObject({ statusCode: 400 })
  })

  it('returns no attachment if auditing fails', async () => {
    mocks.audit.mockRejectedValue(new Error('Audit unavailable'))
    await expect(download({})).rejects.toThrow('Audit unavailable')
    expect(setResponseHeader).not.toHaveBeenCalledWith({}, 'Content-Type', expect.anything())
    expect(setResponseHeader).not.toHaveBeenCalledWith({}, 'Content-Disposition', expect.anything())
  })

  it.each([{}, { cycleId: 'invalid' }, { cycleId, scope: 'day' }, { cycleId, format: 'pdf', sessionLabelId: 'day' }, { cycleId, scope: 'all', format: 'zip', sessionLabelId: 'day' }])('rejects invalid export parameters %j', async (invalid) => {
    query = invalid
    await expect(download({})).rejects.toMatchObject({ statusCode: 400 })
    expect(mocks.load).not.toHaveBeenCalled()
  })

  it('rejects invalid preview parameters and unknown days', async () => {
    query = { cycleId: ['array'] }
    await expect(preview({})).rejects.toMatchObject({ statusCode: 400 })
    query = { cycleId, sessionLabelId: 'foreign' }
    await expect(preview({})).rejects.toMatchObject({ statusCode: 404 })
    await expect(download({})).rejects.toMatchObject({ statusCode: 404 })
  })

  it('rejects empty rosters, missing numeric IDs and oversized responses', async () => {
    mocks.load.mockResolvedValueOnce({ sessions: [{ labelId: 'day' }], rows: [] })
    await expect(download({})).rejects.toMatchObject({ statusCode: 404 })
    mocks.load.mockResolvedValueOnce({ sessions: [{ labelId: 'day' }], rows: [{ ...rows[0], submissionIdInt: undefined }] })
    await expect(download({})).rejects.toMatchObject({ statusCode: 409 })
    mocks.build.mockResolvedValueOnce({ content: Buffer.alloc(4_000_001) })
    await expect(download({})).rejects.toMatchObject({ statusCode: 413 })
    expect(mocks.audit).not.toHaveBeenCalled()
  })
})
