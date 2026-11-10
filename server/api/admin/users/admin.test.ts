import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const userModel = vi.hoisted(() => ({
  find: vi.fn(),
  findOne: vi.fn(),
  findById: vi.fn(),
  create: vi.fn()
}))
const tokenModel = vi.hoisted(() => ({
  find: vi.fn(),
  findOne: vi.fn(),
  findOneAndDelete: vi.fn(),
  create: vi.fn()
}))
const auditModel = vi.hoisted(() => ({ create: vi.fn() }))

vi.mock('../../../models/User', () => ({ UserModel: userModel }))
vi.mock('../../../models/AuthToken', () => ({ AuthTokenModel: tokenModel }))
vi.mock('../../../models/AuditLog', () => ({ AuditLogModel: auditModel }))

type Handler = (event: unknown) => Promise<unknown>
let list: Handler, invite: Handler, invites: Handler, patch: Handler, resetLink: Handler, revoke: Handler

beforeAll(async () => {
  vi.stubGlobal('defineEventHandler', (handler: Handler) => handler)
  const [listMod, inviteMod, invitesMod, patchMod, resetMod, revokeMod] = await Promise.all([
    import('./index.get'),
    import('./invite.post'),
    import('./invites.get'),
    import('./[id].patch'),
    import('./[id]/reset-link.post'),
    import('./invites/[id].delete')
  ])
  list = listMod.default as Handler
  invite = inviteMod.default as Handler
  invites = invitesMod.default as Handler
  patch = patchMod.default as Handler
  resetLink = resetMod.default as Handler
  revoke = revokeMod.default as Handler
})

const siteAdmin = { userId: 'admin-1', email: 'admin@example.test', role: 'site_admin' }
const centralAdmin = { userId: 'user-1', email: 'user@example.test', role: 'central_admin' }

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('connectDb', vi.fn())
  vi.stubGlobal('getRouterParam', vi.fn(() => 'target-1'))
  vi.stubGlobal('createError', (input: { statusCode: number, statusMessage: string }) => Object.assign(new Error(input.statusMessage), input))
  vi.stubGlobal('useRuntimeConfig', vi.fn(() => ({ public: { appUrl: 'https://app.test' } })))
  auditModel.create.mockResolvedValue({})
})

afterEach(() => vi.unstubAllGlobals())

const handlers = () => ({ list, invite, invites, patch, resetLink, revoke })

describe('admin user endpoints require site_admin', () => {
  it.each(['list', 'invite', 'invites', 'patch', 'resetLink', 'revoke'] as const)('rejects a central_admin on %s', async (name) => {
    vi.stubGlobal('requireRole', vi.fn(async (_event: unknown, role: string) => {
      if (centralAdmin.role !== role) {
        throw Object.assign(new Error('Forbidden'), { statusCode: 403 })
      }
      return centralAdmin
    }))
    vi.stubGlobal('readBody', vi.fn(async () => ({ email: 'x@y.test' })))

    await expect(handlers()[name]({})).rejects.toMatchObject({ statusCode: 403 })
    expect(requireRole).toHaveBeenCalledWith({}, 'site_admin')
  })
})

describe('invite', () => {
  it('creates a central_admin invite by default and returns a link', async () => {
    vi.stubGlobal('requireRole', vi.fn(async () => siteAdmin))
    vi.stubGlobal('readBody', vi.fn(async () => ({ email: 'New@Example.test' })))
    userModel.findOne.mockReturnValue({ lean: vi.fn(async () => null) })

    const result = await invite({}) as { inviteUrl: string, email: string, role: string }
    expect(result.email).toBe('new@example.test')
    expect(result.role).toBe('central_admin')
    expect(result.inviteUrl).toMatch(/^https:\/\/app\.test\/accept-invite\?token=.+/)
    expect(tokenModel.create).toHaveBeenCalledWith(expect.objectContaining({
      type: 'invite',
      email: 'new@example.test',
      role: 'central_admin',
      createdBy: siteAdmin.email
    }))
    expect(auditModel.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'user_invited' }))
  })

  it('rejects inviting an existing account', async () => {
    vi.stubGlobal('requireRole', vi.fn(async () => siteAdmin))
    vi.stubGlobal('readBody', vi.fn(async () => ({ email: 'user@example.test' })))
    userModel.findOne.mockReturnValue({ lean: vi.fn(async () => ({ email: 'user@example.test' })) })

    await expect(invite({})).rejects.toMatchObject({ statusCode: 409 })
    expect(tokenModel.create).not.toHaveBeenCalled()
  })
})

describe('patch user', () => {
  it('prevents a site admin from disabling their own account', async () => {
    vi.stubGlobal('requireRole', vi.fn(async () => siteAdmin))
    vi.stubGlobal('readBody', vi.fn(async () => ({ status: 'disabled' })))
    const self = { _id: 'admin-1', role: 'site_admin', status: 'active', save: vi.fn() }
    userModel.findById.mockResolvedValue(self)

    await expect(patch({})).rejects.toMatchObject({ statusCode: 400 })
    expect(self.save).not.toHaveBeenCalled()
  })

  it('records an audit entry on role change', async () => {
    vi.stubGlobal('requireRole', vi.fn(async () => siteAdmin))
    vi.stubGlobal('readBody', vi.fn(async () => ({ role: 'site_admin' })))
    const target = { _id: 'target-1', role: 'central_admin', status: 'active', save: vi.fn() }
    userModel.findById.mockResolvedValue(target)

    await expect(patch({})).resolves.toEqual({ ok: true })
    expect(target.role).toBe('site_admin')
    expect(target.save).toHaveBeenCalled()
    expect(auditModel.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'user_updated' }))
  })
})

describe('reset link', () => {
  it('creates a reset token and clears the user flag', async () => {
    vi.stubGlobal('requireRole', vi.fn(async () => siteAdmin))
    const user = { _id: 'target-1', email: 'user@example.test', passwordResetRequestedAt: new Date(), save: vi.fn() }
    userModel.findById.mockResolvedValue(user)

    const result = await resetLink({}) as { resetUrl: string }
    expect(result.resetUrl).toMatch(/^https:\/\/app\.test\/reset-password\?token=.+/)
    expect(tokenModel.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'reset', userId: 'target-1' }))
    expect(user.passwordResetRequestedAt).toBeUndefined()
    expect(user.save).toHaveBeenCalled()
    expect(auditModel.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'reset_link_created' }))
  })
})
