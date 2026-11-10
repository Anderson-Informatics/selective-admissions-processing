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
  const invite = await findValidToken(token, 'invite')
  if (!invite) {
    throw createError({ statusCode: 400, statusMessage: 'This invitation link is invalid or has expired' })
  }

  const existing = await UserModel.findOne({ email: invite.email })
  if (existing) {
    throw createError({ statusCode: 409, statusMessage: 'An account already exists for this email' })
  }

  const user = await UserModel.create({
    email: invite.email,
    passwordHash: await hashPassword(String(password)),
    role: invite.role ?? 'central_admin'
  })
  await AuthTokenModel.updateOne({ _id: invite._id }, { $set: { consumedAt: new Date() } })
  await AuditLogModel.create({
    action: 'user_registered',
    actor: user.email,
    entityType: 'user',
    entityId: String(user._id),
    changes: [{ path: 'role', after: user.role }]
  })

  return { email: user.email, role: user.role }
})
