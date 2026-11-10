import { AuthTokenModel } from '../../../../models/AuthToken'
import { AuditLogModel } from '../../../../models/AuditLog'

export default defineEventHandler(async (event) => {
  const admin = await requireRole(event, 'site_admin')
  const id = getRouterParam(event, 'id')

  await connectDb()
  const invite = await AuthTokenModel.findOneAndDelete({ _id: id, type: 'invite', consumedAt: { $exists: false } })
  if (!invite) {
    throw createError({ statusCode: 404, statusMessage: 'Invitation not found' })
  }
  await AuditLogModel.create({
    action: 'invite_revoked',
    actor: admin.email,
    entityType: 'user',
    entityId: invite.email
  })
  return { ok: true }
})
