import { UserModel } from '../../models/User'
import { AuditLogModel } from '../../models/AuditLog'
import { LOCKOUT_MINUTES, MAX_FAILED_ATTEMPTS, verifyPassword } from '../../utils/password'

const invalidCredentials = () => createError({ statusCode: 401, statusMessage: 'Invalid email or password' })

export default defineEventHandler(async (event) => {
  const { email, password } = await readBody(event)
  if (!email || !password) {
    throw createError({ statusCode: 400, statusMessage: 'Email and password are required' })
  }

  await connectDb()
  const user = await UserModel.findOne({ email: String(email).toLowerCase().trim() })
  if (!user || user.status !== 'active') {
    // Hash-comparing a constant keeps invalid-email timing close to a real check.
    await verifyPassword(String(password), 'scrypt:16384:00000000000000000000000000000000:' + '0'.repeat(128))
    throw invalidCredentials()
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw createError({ statusCode: 423, statusMessage: `Account is temporarily locked. Try again after ${user.lockedUntil.toISOString()}` })
  }

  if (!(await verifyPassword(String(password), user.passwordHash))) {
    user.failedLoginAttempts += 1
    if (user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
      user.lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000)
      await AuditLogModel.create({
        action: 'account_locked',
        actor: user.email,
        entityType: 'user',
        entityId: String(user._id),
        changes: [{ path: 'failedLoginAttempts', after: user.failedLoginAttempts }]
      })
    }
    await user.save()
    throw invalidCredentials()
  }

  user.failedLoginAttempts = 0
  user.lockedUntil = undefined
  user.lastLoginAt = new Date()
  await user.save()

  await setAuthSession(event, { userId: String(user._id), email: user.email, role: user.role })
  return { email: user.email, role: user.role }
})
