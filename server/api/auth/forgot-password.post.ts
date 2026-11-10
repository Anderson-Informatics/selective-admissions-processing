import { UserModel } from '../../models/User'
import { AuditLogModel } from '../../models/AuditLog'

export default defineEventHandler(async (event) => {
  const { email } = await readBody(event)
  if (!email) {
    throw createError({ statusCode: 400, statusMessage: 'Email is required' })
  }

  await connectDb()
  const user = await UserModel.findOne({ email: String(email).toLowerCase().trim(), status: 'active' })
  if (user && !user.passwordResetRequestedAt) {
    user.passwordResetRequestedAt = new Date()
    await user.save()
    await AuditLogModel.create({
      action: 'password_reset_requested',
      actor: user.email,
      entityType: 'user',
      entityId: String(user._id)
    })
  }

  // Neutral response regardless of whether the account exists.
  return { ok: true }
})
