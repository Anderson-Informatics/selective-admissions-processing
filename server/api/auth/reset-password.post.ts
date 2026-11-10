import { UserModel } from '../../models/User'
import { AuthTokenModel } from '../../models/AuthToken'
import { AuditLogModel } from '../../models/AuditLog'
import { findValidToken } from '../../utils/authTokens'
import { hashPassword, validatePassword } from '../../utils/password'

export default defineEventHandler(async (event) => {
  const { token, password } = await readBody(event)

  const policyError = validatePassword(password)
  if (policyError) {
    throw createError({ statusCode: 400, statusMessage: policyError })
  }

  await connectDb()
  const reset = await findValidToken(token, 'reset')
  if (!reset) {
    throw createError({ statusCode: 400, statusMessage: 'This reset link is invalid or has expired' })
  }

  const user = await UserModel.findById(reset.userId)
  if (!user) {
    throw createError({ statusCode: 400, statusMessage: 'This reset link is invalid or has expired' })
  }

  user.passwordHash = await hashPassword(String(password))
  user.passwordResetRequestedAt = undefined
  user.failedLoginAttempts = 0
  user.lockedUntil = undefined
  await user.save()
  await AuthTokenModel.updateOne({ _id: reset._id }, { $set: { consumedAt: new Date() } })
  await AuditLogModel.create({
    action: 'password_reset_completed',
    actor: user.email,
    entityType: 'user',
    entityId: String(user._id)
  })

  return { ok: true }
})
