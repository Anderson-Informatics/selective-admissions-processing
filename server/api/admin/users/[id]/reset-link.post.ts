import { UserModel } from '../../../../models/User'
import { AuditLogModel } from '../../../../models/AuditLog'
import { createAuthToken } from '../../../../utils/authTokens'

export default defineEventHandler(async (event) => {
  const admin = await requireRole(event, 'site_admin')
  const id = getRouterParam(event, 'id')

  await connectDb()
  const user = await UserModel.findById(id)
  if (!user) {
    throw createError({ statusCode: 404, statusMessage: 'User not found' })
  }

  const token = await createAuthToken({
    type: 'reset',
    email: user.email,
    userId: String(user._id),
    createdBy: admin.email,
    ttlHours: 24
  })
  user.passwordResetRequestedAt = undefined
  await user.save()
  await AuditLogModel.create({
    action: 'reset_link_created',
    actor: admin.email,
    entityType: 'user',
    entityId: String(user._id)
  })

  const appUrl = useRuntimeConfig().public.appUrl || ''
  return { resetUrl: `${appUrl}/reset-password?token=${token}`, email: user.email }
})
