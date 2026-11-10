import { UserModel } from '../../../models/User'
import { AuditLogModel } from '../../../models/AuditLog'

export default defineEventHandler(async (event) => {
  const admin = await requireRole(event, 'site_admin')
  const id = getRouterParam(event, 'id')
  const body = await readBody<{ role?: string, status?: string }>(event)

  await connectDb()
  const user = await UserModel.findById(id)
  if (!user) {
    throw createError({ statusCode: 404, statusMessage: 'User not found' })
  }

  const changes: { path: string, before: unknown, after: unknown }[] = []
  if (body.role !== undefined) {
    if (body.role !== 'site_admin' && body.role !== 'central_admin') {
      throw createError({ statusCode: 400, statusMessage: 'role must be site_admin or central_admin' })
    }
    if (body.role !== user.role) changes.push({ path: 'role', before: user.role, after: body.role })
    user.role = body.role
  }
  if (body.status !== undefined) {
    if (body.status !== 'active' && body.status !== 'disabled') {
      throw createError({ statusCode: 400, statusMessage: 'status must be active or disabled' })
    }
    if (body.status !== user.status) changes.push({ path: 'status', before: user.status, after: body.status })
    user.status = body.status
  }

  // Prevent locking yourself out or demoting yourself mid-request.
  if (String(user._id) === admin.userId && (user.status === 'disabled' || user.role !== 'site_admin')) {
    throw createError({ statusCode: 400, statusMessage: 'You cannot disable or demote your own account' })
  }

  if (changes.length) {
    await user.save()
    await AuditLogModel.create({
      action: 'user_updated',
      actor: admin.email,
      entityType: 'user',
      entityId: String(user._id),
      changes
    })
  }
  return { ok: true }
})
