import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DPSCD_API_ACTOR } from '../../../utils/dpscdAuth'
import { requireAuth } from '../../../utils/auth'
import { recordDisclosure } from '../../../utils/disclosureAudit'

const models = vi.hoisted(() => ({
  uploads: { create: vi.fn(), findByIdAndUpdate: vi.fn(), findOne: vi.fn() },
  jobs: { create: vi.fn(), findOne: vi.fn(), findById: vi.fn() },
  batches: { findOne: vi.fn() }
}))
vi.mock('~~/server/models/GpaUpload', () => ({ GpaUploadModel: models.uploads }))
vi.mock('~~/server/models/Job', () => ({ JobModel: models.jobs }))
vi.mock('../../../models/RoutingBatch', () => ({ RoutingBatchModel: models.batches }))
vi.mock('~~/server/utils/gpa', () => ({ parseDpscdBody: (raw: string) => JSON.parse(raw) }))
vi.mock('../../../utils/auth', () => ({ requireAuth: vi.fn() }))
vi.mock('../../../utils/disclosureAudit', () => ({ recordDisclosure: vi.fn(async () => {}) }))

type Event = { authorization?: string, id?: string, query?: Record<string, unknown> }
type Handler = (event: Event) => Promise<unknown>
let post: Handler
let uploadGet: Handler
let jobGet: Handler
const id = '507f1f77bcf86cd799439011'
const jobId = '507f1f77bcf86cd799439012'
const config = { dataKey: 'test-data-key', dataSecret: 'test-secret', public: { appUrl: 'http://localhost:3000' }, jobDispatchSecret: 'dispatch-test' }
const query = (value: unknown) => ({ select: vi.fn().mockReturnThis(), lean: vi.fn(async () => value) })

beforeAll(async () => {
  vi.stubGlobal('defineEventHandler', (handler: Handler) => handler)
  post = (await import('./index.post')).default as unknown as Handler
  uploadGet = (await import('./[id].get')).default as unknown as Handler
  jobGet = (await import('../../jobs/[id].get')).default as unknown as Handler
})

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('createError', (input: { statusCode: number, statusMessage: string }) => Object.assign(new Error(input.statusMessage), input))
  vi.stubGlobal('getHeader', (event: Event) => event.authorization)
  vi.stubGlobal('useRuntimeConfig', () => config)
  vi.stubGlobal('connectDb', vi.fn())
  vi.stubGlobal('getQuery', (event: Event) => event.query || {})
  vi.stubGlobal('getRouterParam', (event: Event) => event.id)
  vi.stubGlobal('readRawBody', vi.fn(async () => JSON.stringify({ cycleId: 'cycle-1', records: [{ STUDENT_NUMBER: 12345, gpa_r1: 3.5, quarters_available_r1: 5 }] })))
  vi.stubGlobal('fetch', vi.fn(async () => ({})))
  vi.mocked(requireAuth).mockRejectedValue(Object.assign(new Error('Unauthorized'), { statusCode: 401 }))
  models.uploads.create.mockResolvedValue({ _id: id })
  models.jobs.create.mockResolvedValue({ _id: jobId })
  models.uploads.findByIdAndUpdate.mockResolvedValue(null)
  models.uploads.findOne.mockReturnValue(query(null))
  models.jobs.findOne.mockReturnValue(query(null))
  models.jobs.findById.mockReturnValue(query(null))
})

afterEach(() => vi.unstubAllGlobals())

describe('DPSCD API key authentication', () => {
  it.each(['Bearer wrong-key', 'Basic test-data-key', 'Bearer test-data-key extra', ''])('rejects invalid authorization %j before database or body access', async (authorization) => {
    for (const handler of [post, uploadGet, jobGet]) {
      await expect(handler({ authorization, id })).rejects.toMatchObject({ statusCode: 401 })
    }
    expect(connectDb).not.toHaveBeenCalled()
    expect(readRawBody).not.toHaveBeenCalled()
    expect(requireAuth).not.toHaveBeenCalled()
  })

  it('rejects missing credentials', async () => {
    for (const handler of [post, uploadGet, jobGet]) await expect(handler({ id })).rejects.toMatchObject({ statusCode: 401 })
    expect(connectDb).not.toHaveBeenCalled()
  })

  it.each([{ dataKey: '', dataSecret: 'secret' }, { dataKey: 'key', dataSecret: '' }])('fails closed with missing configuration %j', async (missing) => {
    vi.stubGlobal('useRuntimeConfig', () => ({ ...config, ...missing }))
    for (const handler of [post, uploadGet, jobGet]) await expect(handler({ authorization: 'Bearer test-data-key', id })).rejects.toMatchObject({ statusCode: 503 })
    expect(connectDb).not.toHaveBeenCalled()
  })

  it.each([true, false])('accepts a valid key and records the service identity (dryRun=%s)', async (dryRun) => {
    await expect(post({ authorization: 'Bearer test-data-key', query: dryRun ? { dryRun: 'true' } : {} })).resolves.toEqual({ uploadId: id, jobId, records: 1 })
    expect(models.uploads.create).toHaveBeenCalledWith(expect.objectContaining({ createdBy: DPSCD_API_ACTOR, source: 'dpscd' }))
    expect(models.jobs.create).toHaveBeenCalledWith(expect.objectContaining({ createdBy: DPSCD_API_ACTOR, type: 'dpscd_gpa_import', payload: { uploadId: id, dryRun } }))
    expect(requireAuth).not.toHaveBeenCalled()
  })

  it('retains session imports without requiring a data-key configuration', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({ ...config, dataKey: '', dataSecret: '' }))
    vi.mocked(requireAuth).mockResolvedValue({ email: 'admin@example.test', userId: 'u1', role: 'site_admin' })
    await post({})
    expect(models.uploads.create).toHaveBeenCalledWith(expect.objectContaining({ createdBy: 'admin@example.test' }))
  })

  it('does not fall back to a valid session when an invalid key is supplied', async () => {
    vi.mocked(requireAuth).mockResolvedValue({ email: 'admin@example.test', userId: 'u1', role: 'site_admin' })
    await expect(post({ authorization: 'Bearer wrong-key' })).rejects.toMatchObject({ statusCode: 401 })
    expect(requireAuth).not.toHaveBeenCalled()
  })

  it('scopes key-based job polling to API-created DPSCD imports and projects result fields', async () => {
    const job = { _id: jobId, type: 'dpscd_gpa_import', status: 'completed', result: { dryRun: true } }
    const jobQuery = query(job)
    models.jobs.findOne.mockReturnValue(jobQuery)
    await expect(jobGet({ authorization: 'Bearer test-data-key', id: jobId })).resolves.toEqual(job)
    expect(models.jobs.findOne).toHaveBeenCalledWith({ _id: jobId, type: 'dpscd_gpa_import', createdBy: DPSCD_API_ACTOR })
    expect(jobQuery.select).toHaveBeenCalledWith('type status progress result error cycleId createdAt updatedAt')
    expect(recordDisclosure).toHaveBeenCalledWith({ actor: DPSCD_API_ACTOR, action: 'data_api_disclosure', entityType: 'Job', entityId: jobId })
    expect(models.jobs.findById).not.toHaveBeenCalled()
  })

  it('does not expose missing, non-DPSCD, or session-created jobs through key polling', async () => {
    await expect(jobGet({ authorization: 'Bearer test-data-key', id: jobId })).rejects.toMatchObject({ statusCode: 404 })
    expect(models.jobs.findOne).toHaveBeenCalledWith({ _id: jobId, type: 'dpscd_gpa_import', createdBy: DPSCD_API_ACTOR })
    expect(models.jobs.findById).not.toHaveBeenCalled()
  })

  it('rejects routing-batch access with a key', async () => {
    await expect(jobGet({ authorization: 'Bearer test-data-key', id: jobId, query: { batch: 0 } })).rejects.toMatchObject({ statusCode: 403 })
    expect(models.batches.findOne).not.toHaveBeenCalled()
    expect(models.jobs.findOne).not.toHaveBeenCalled()
  })

  it('retains session access to other jobs and routing batches', async () => {
    vi.mocked(requireAuth).mockResolvedValue({ email: 'admin@example.test', userId: 'u1', role: 'site_admin' })
    models.jobs.findById.mockReturnValue(query({ _id: jobId, type: 'run_routing' }))
    await expect(jobGet({ id: jobId })).resolves.toMatchObject({ type: 'run_routing' })
    models.batches.findOne.mockReturnValue(query({ batch: 0 }))
    await expect(jobGet({ id: jobId, query: { batch: 0 } })).resolves.toEqual({ batch: 0 })
    expect(models.batches.findOne).toHaveBeenCalledWith({ jobId, index: 0 })
  })

  it('allows key polling of owned DPSCD uploads without returning staged records', async () => {
    const uploadQuery = query({ _id: id, importJobId: jobId })
    models.uploads.findOne.mockReturnValue(uploadQuery)
    models.jobs.findOne.mockReturnValue(query({ status: 'completed', result: { dryRun: true } }))
    await expect(uploadGet({ authorization: 'Bearer test-data-key', id })).resolves.toMatchObject({ upload: { _id: id }, job: { status: 'completed' } })
    expect(models.uploads.findOne).toHaveBeenCalledWith({ _id: id, source: 'dpscd', createdBy: DPSCD_API_ACTOR })
    expect(uploadQuery.select).toHaveBeenCalledWith('-files -records')
    expect(models.jobs.findOne).toHaveBeenCalledWith({ _id: jobId, type: 'dpscd_gpa_import', createdBy: DPSCD_API_ACTOR })
    expect(models.jobs.findById).not.toHaveBeenCalled()
    expect(recordDisclosure).toHaveBeenCalledWith({ actor: DPSCD_API_ACTOR, action: 'data_api_disclosure', entityType: 'GpaUpload', entityId: id })
  })

  it('does not expose uploads owned by other actors', async () => {
    await expect(uploadGet({ authorization: 'Bearer test-data-key', id })).rejects.toMatchObject({ statusCode: 404 })
    expect(models.jobs.findById).not.toHaveBeenCalled()
  })

  it('retains session upload ownership and result polling', async () => {
    vi.mocked(requireAuth).mockResolvedValue({ email: 'admin@example.test', userId: 'u1', role: 'site_admin' })
    models.uploads.findOne.mockReturnValue(query({ _id: id, importJobId: jobId }))
    models.jobs.findById.mockReturnValue(query({ status: 'completed' }))
    await expect(uploadGet({ id })).resolves.toMatchObject({ job: { status: 'completed' } })
    expect(models.uploads.findOne).toHaveBeenCalledWith({ _id: id, createdBy: 'admin@example.test', source: 'dpscd' })
    expect(models.jobs.findById).toHaveBeenCalledWith(jobId)
    expect(recordDisclosure).not.toHaveBeenCalled()
  })

  it('does not return data if disclosure auditing fails', async () => {
    models.jobs.findOne.mockReturnValue(query({ status: 'completed' }))
    vi.mocked(recordDisclosure).mockRejectedValueOnce(new Error('audit unavailable'))
    await expect(jobGet({ authorization: 'Bearer test-data-key', id: jobId })).rejects.toThrow('audit unavailable')
  })

  it('validates polling IDs', async () => {
    for (const handler of [uploadGet, jobGet]) await expect(handler({ authorization: 'Bearer test-data-key', id: 'invalid' })).rejects.toMatchObject({ statusCode: 400 })
    expect(models.jobs.findOne).not.toHaveBeenCalled()
    expect(models.uploads.findOne).not.toHaveBeenCalled()
  })
})
