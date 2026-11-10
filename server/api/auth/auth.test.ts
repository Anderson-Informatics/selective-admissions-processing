import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashPassword, validatePassword, verifyPassword } from '../../utils/password'

const userModel = vi.hoisted(() => ({
  findOne: vi.fn(),
  findById: vi.fn(),
  create: vi.fn()
}))
const tokenModel = vi.hoisted(() => ({
  findOne: vi.fn(),
  findOneAndDelete: vi.fn(),
  create: vi.fn(),
  updateOne: vi.fn()
}))
const auditModel = vi.hoisted(() => ({ create: vi.fn() }))

vi.mock('../../models/User', () => ({ UserModel: userModel }))
vi.mock('../../models/AuthToken', () => ({ AuthTokenModel: tokenModel }))
vi.mock('../../models/AuditLog', () => ({ AuditLogModel: auditModel }))

type Handler = (event: unknown) => Promise<unknown>
let login: Handler, register: Handler, resetPassword: Handler, forgot: Handler, validateToken: Handler

beforeAll(async () => {
  vi.stubGlobal('defineEventHandler', (handler: Handler) => handler)
  const [loginMod, registerMod, resetMod, forgotMod, validateMod] = await Promise.all([
    import('./login.post'),
    import('./register.post'),
    import('./reset-password.post'),
    import('./forgot-password.post'),
    import('./validate-token.post')
  ])
  login = loginMod.default as Handler
  register = registerMod.default as Handler
  resetPassword = resetMod.default as Handler
  forgot = forgotMod.default as Handler
  validateToken = validateMod.default as Handler
})

const setAuthSession = vi.fn()

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('connectDb', vi.fn())
  vi.stubGlobal('setAuthSession', setAuthSession)
  vi.stubGlobal('createError', (input: { statusCode: number, statusMessage: string }) => Object.assign(new Error(input.statusMessage), input))
  auditModel.create.mockResolvedValue({})
})

afterEach(() => vi.unstubAllGlobals())

function userDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: 'user-1',
    email: 'user@example.test',
    role: 'central_admin',
    status: 'active',
    failedLoginAttempts: 0,
    save: vi.fn(),
    ...overrides
  }
}

describe('password utils', () => {
  it('hashes and verifies a password', async () => {
    const hash = await hashPassword('correct horse battery1')
    expect(hash).toMatch(/^scrypt:16384:/)
    await expect(verifyPassword('correct horse battery1', hash)).resolves.toBe(true)
    await expect(verifyPassword('wrong pass1', hash)).resolves.toBe(false)
  })

  it('enforces the password policy', () => {
    expect(validatePassword('short1')).toBeTruthy()
    expect(validatePassword('onlylettersandmore')).toBeTruthy()
    expect(validatePassword('123456789012')).toBeTruthy()
    expect(validatePassword('a-valid-password-1')).toBeNull()
  })
})

describe('login', () => {
  it('signs in and resets failed attempts', async () => {
    const passwordHash = await hashPassword('a-valid-password-1')
    const user = userDoc({ passwordHash, failedLoginAttempts: 2 })
    userModel.findOne.mockResolvedValue(user)
    vi.stubGlobal('readBody', vi.fn(async () => ({ email: 'User@Example.Test ', password: 'a-valid-password-1' })))

    await expect(login({})).resolves.toEqual({ email: 'user@example.test', role: 'central_admin' })
    expect(user.failedLoginAttempts).toBe(0)
    expect(user.save).toHaveBeenCalled()
    expect(setAuthSession).toHaveBeenCalledWith({}, { userId: 'user-1', email: 'user@example.test', role: 'central_admin' })
  })

  it('rejects wrong passwords and locks after 5 failures', async () => {
    const passwordHash = await hashPassword('a-valid-password-1')
    const user = userDoc({ passwordHash, failedLoginAttempts: 4 })
    userModel.findOne.mockResolvedValue(user)
    vi.stubGlobal('readBody', vi.fn(async () => ({ email: 'user@example.test', password: 'nope-123456' })))

    await expect(login({})).rejects.toMatchObject({ statusCode: 401 })
    expect(user.failedLoginAttempts).toBe(5)
    expect(user.lockedUntil).toBeInstanceOf(Date)
    expect(auditModel.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'account_locked' }))
  })

  it('rejects a locked account before checking the password', async () => {
    const user = userDoc({ passwordHash: 'x', lockedUntil: new Date(Date.now() + 60000) })
    userModel.findOne.mockResolvedValue(user)
    vi.stubGlobal('readBody', vi.fn(async () => ({ email: 'user@example.test', password: 'a-valid-password-1' })))

    await expect(login({})).rejects.toMatchObject({ statusCode: 423 })
    expect(setAuthSession).not.toHaveBeenCalled()
  })

  it('rejects unknown and disabled accounts identically', async () => {
    vi.stubGlobal('readBody', vi.fn(async () => ({ email: 'ghost@example.test', password: 'a-valid-password-1' })))
    userModel.findOne.mockResolvedValue(null)
    await expect(login({})).rejects.toMatchObject({ statusCode: 401 })

    userModel.findOne.mockResolvedValue(userDoc({ status: 'disabled' }))
    await expect(login({})).rejects.toMatchObject({ statusCode: 401 })
  })
})

describe('registration via invitation', () => {
  const invite = {
    _id: 'token-1',
    email: 'invitee@example.test',
    role: 'central_admin',
    expiresAt: new Date(Date.now() + 60000)
  }

  it('creates a central_admin user and consumes the token', async () => {
    tokenModel.findOne.mockReturnValue({ lean: vi.fn(async () => invite) })
    userModel.findOne.mockResolvedValue(null)
    userModel.create.mockResolvedValue({ _id: 'new-user', email: invite.email, role: 'central_admin' })
    vi.stubGlobal('readBody', vi.fn(async () => ({ token: 'raw-token', password: 'a-valid-password-1' })))

    await expect(register({})).resolves.toEqual({ email: invite.email, role: 'central_admin' })
    expect(userModel.create).toHaveBeenCalledWith(expect.objectContaining({ email: invite.email, role: 'central_admin' }))
    expect(tokenModel.updateOne).toHaveBeenCalledWith({ _id: 'token-1' }, { $set: { consumedAt: expect.any(Date) } })
    expect(auditModel.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'user_registered' }))
  })

  it('rejects invalid or consumed tokens', async () => {
    tokenModel.findOne.mockReturnValue({ lean: vi.fn(async () => null) })
    vi.stubGlobal('readBody', vi.fn(async () => ({ token: 'bad-token', password: 'a-valid-password-1' })))
    await expect(register({})).rejects.toMatchObject({ statusCode: 400 })
    expect(userModel.create).not.toHaveBeenCalled()
  })

  it('rejects weak passwords before touching the token', async () => {
    vi.stubGlobal('readBody', vi.fn(async () => ({ token: 'raw-token', password: 'weak' })))
    await expect(register({})).rejects.toMatchObject({ statusCode: 400 })
    expect(tokenModel.findOne).not.toHaveBeenCalled()
  })
})

describe('password reset', () => {
  it('updates the password and clears the reset flag', async () => {
    const user = userDoc({ passwordResetRequestedAt: new Date(), failedLoginAttempts: 5, lockedUntil: new Date() })
    tokenModel.findOne.mockReturnValue({ lean: vi.fn(async () => ({ _id: 'tok', userId: 'user-1', type: 'reset', expiresAt: new Date(Date.now() + 60000) })) })
    userModel.findById.mockResolvedValue(user)
    vi.stubGlobal('readBody', vi.fn(async () => ({ token: 'raw-token', password: 'new-password-123' })))

    await expect(resetPassword({})).resolves.toEqual({ ok: true })
    expect(user.passwordHash).toMatch(/^scrypt:/)
    expect(user.passwordResetRequestedAt).toBeUndefined()
    expect(user.failedLoginAttempts).toBe(0)
    expect(user.lockedUntil).toBeUndefined()
    expect(tokenModel.updateOne).toHaveBeenCalled()
  })
})

describe('forgot password', () => {
  it('flags an existing account and always returns ok', async () => {
    const user = userDoc()
    userModel.findOne.mockResolvedValue(user)
    vi.stubGlobal('readBody', vi.fn(async () => ({ email: 'user@example.test' })))

    await expect(forgot({})).resolves.toEqual({ ok: true })
    expect(user.passwordResetRequestedAt).toBeInstanceOf(Date)
    expect(auditModel.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'password_reset_requested' }))
  })

  it('returns ok for unknown emails without flagging anything', async () => {
    userModel.findOne.mockResolvedValue(null)
    vi.stubGlobal('readBody', vi.fn(async () => ({ email: 'ghost@example.test' })))
    await expect(forgot({})).resolves.toEqual({ ok: true })
    expect(auditModel.create).not.toHaveBeenCalled()
  })
})

describe('token validation', () => {
  it('reports valid invite tokens and invalid tokens', async () => {
    tokenModel.findOne
      .mockReturnValueOnce({ lean: vi.fn(async () => ({ email: 'a@b.test', type: 'invite' })) })
    vi.stubGlobal('readBody', vi.fn(async () => ({ token: 'raw-token' })))
    await expect(validateToken({})).resolves.toEqual({ valid: true, type: 'invite', email: 'a@b.test' })

    tokenModel.findOne.mockReturnValue({ lean: vi.fn(async () => null) })
    await expect(validateToken({})).resolves.toEqual({ valid: false })
  })
})
