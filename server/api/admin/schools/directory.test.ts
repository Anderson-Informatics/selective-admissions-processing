import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const models = vi.hoisted(() => ({
  school: { findOne: vi.fn(), findById: vi.fn(), create: vi.fn(), exists: vi.fn(), countDocuments: vi.fn() },
  representative: { findOne: vi.fn(), exists: vi.fn(), findOneAndUpdate: vi.fn() },
  authority: { findOne: vi.fn(), findOneAndUpdate: vi.fn() },
  metadata: { exists: vi.fn() }, application: { exists: vi.fn() }, cycle: { exists: vi.fn() }, audit: { create: vi.fn() }
}))
vi.mock('../../../models/School', () => ({ SchoolModel: models.school }))
vi.mock('../../../models/SchoolRepresentative', () => ({ SchoolRepresentativeModel: models.representative }))
vi.mock('../../../models/SchoolAuthority', () => ({ SchoolAuthorityModel: models.authority }))
vi.mock('../../../models/Metadata', () => ({ MetadataModel: models.metadata }))
vi.mock('../../../models/Application', () => ({ ApplicationModel: models.application }))
vi.mock('../../../models/Cycle', () => ({ CycleModel: models.cycle }))
vi.mock('../../../models/AuditLog', () => ({ AuditLogModel: models.audit }))

type Handler = (event: unknown) => Promise<unknown>
let school: Handler, representative: Handler, authority: Handler, list: Handler
const schoolId = '507f1f77bcf86cd799439011'
const cycleId = '507f1f77bcf86cd799439012'
const applicationId = '507f1f77bcf86cd799439013'
const lean = (value: unknown) => ({ lean: async () => value })
beforeAll(async () => {
  vi.stubGlobal('defineEventHandler', (handler: Handler) => handler)
  school = (await import('./index.post')).default as Handler
  representative = (await import('../school-representatives/index.post')).default as Handler
  authority = (await import('../school-representatives/authority.post')).default as Handler
  list = (await import('./index.get')).default as Handler
})
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('connectDb', vi.fn())
  vi.stubGlobal('requireRole', vi.fn(async () => ({ email: 'admin@example.test' })))
  vi.stubGlobal('createError', (value: object) => Object.assign(new Error(), value))
  vi.stubGlobal('readBody', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())

it.each(['school', 'representative', 'authority', 'list'])('requires site_admin for %s', async (name) => {
  vi.stubGlobal('requireRole', vi.fn(async () => {
    throw Object.assign(new Error(), { statusCode: 403 })
  }))
  await expect(({ school, representative, authority, list }[name]!)({})).rejects.toMatchObject({ statusCode: 403 })
  expect(requireRole).toHaveBeenCalledWith({}, 'site_admin')
})

describe('directory mutations', () => {
  it('rejects a name or alias owned by another school', async () => {
    vi.mocked(readBody).mockResolvedValue({ name: 'New', aliases: [' Existing '] })
    models.school.findOne.mockReturnValue(lean({ name: 'Existing school' }))
    await expect(school({})).rejects.toMatchObject({ statusCode: 409 })
    expect(models.school.create).not.toHaveBeenCalled()
  })
  it('creates a normalized school with an audit, not a site account', async () => {
    vi.mocked(readBody).mockResolvedValue({ name: ' School A ', aliases: ['Alias'] })
    models.school.findOne.mockReturnValue(lean(null))
    models.school.create.mockResolvedValue({ _id: schoolId, toObject: () => ({ name: 'School A' }) })
    await school({})
    expect(models.school.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'School A', matchKeys: ['school a', 'alias'] }))
    expect(models.audit.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'school_updated' }))
  })
  it('requires a synced identity for new affiliations', async () => {
    vi.mocked(readBody).mockResolvedValue({ userId: 'user', schoolIds: [schoolId] })
    models.representative.findOne.mockReturnValue(lean(null))
    models.metadata.exists.mockResolvedValue(null)
    await expect(representative({})).rejects.toMatchObject({ statusCode: 400 })
  })
  it('preserves an existing identity when synced metadata is missing', async () => {
    vi.mocked(readBody).mockResolvedValue({ userId: 'user', schoolIds: [schoolId] })
    models.representative.findOne.mockReturnValue(lean({ userId: 'user' }))
    models.school.countDocuments.mockResolvedValue(1)
    models.representative.findOneAndUpdate.mockResolvedValue({ toObject: () => ({ userId: 'user' }) })
    await representative({})
    expect(models.metadata.exists).not.toHaveBeenCalled()
    expect(models.audit.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'school_representative_updated' }))
  })
  it('rejects authority for an application outside the cycle', async () => {
    vi.mocked(readBody).mockResolvedValue({ cycleId, applicationId, schoolId, userId: 'primary' })
    models.school.exists.mockResolvedValue({})
    models.cycle.exists.mockResolvedValue({})
    models.application.exists.mockResolvedValue(null)
    await expect(authority({})).rejects.toMatchObject({ statusCode: 400 })
    expect(models.authority.findOneAndUpdate).not.toHaveBeenCalled()
  })
  it('requires an active affiliated primary reviewer', async () => {
    vi.mocked(readBody).mockResolvedValue({ cycleId, schoolId, userId: 'primary' })
    models.school.exists.mockResolvedValue({})
    models.cycle.exists.mockResolvedValue({})
    models.representative.exists.mockResolvedValue(null)
    await expect(authority({})).rejects.toMatchObject({ statusCode: 400 })
  })
  it('versions and audits an explicit authority change', async () => {
    vi.mocked(readBody).mockResolvedValue({ cycleId, schoolId, userId: 'primary' })
    models.school.exists.mockResolvedValue({})
    models.cycle.exists.mockResolvedValue({})
    models.representative.exists.mockResolvedValue({})
    models.authority.findOne.mockReturnValue(lean(null))
    models.authority.findOneAndUpdate.mockResolvedValue({ _id: schoolId, toObject: () => ({ userId: 'primary', version: 1 }) })
    await authority({})
    expect(models.authority.findOneAndUpdate).toHaveBeenCalledWith({ cycleId, schoolId, applicationId: '' }, { $set: { userId: 'primary' }, $inc: { version: 1 } }, { upsert: true, new: true })
    expect(models.audit.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'school_authority_updated', cycleId }))
  })
})
