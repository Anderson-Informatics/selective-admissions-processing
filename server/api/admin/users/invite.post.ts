import { UserModel } from '../../../models/User'
import { AuditLogModel } from '../../../models/AuditLog'
import { createAuthToken } from '../../../utils/authTokens'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default defineEventHandler(async (event) => {
  const admin = await requireRole(event, 'site_admin')
  const { email, role } = await readBody<{ email?: string, role?: string }>(event)

  const normalized = String(email ?? '').toLowerCase().trim()
  if (!EMAIL_RE.test(normalized)) {
    throw createError({ statusCode: 400, statusMessage: 'A valid email is required' })
  }
  const inviteRole = role === 'site_admin' ? 'site_admin' : 'central_admin'

  await connectDb()
  const existing = await UserModel.findOne({ email: normalized }).lean()
  if (existing) {
    throw createError({ statusCode: 409, statusMessage: 'An account already exists for this email' })
  }

  const token = await createAuthToken({ type: 'invite', email: normalized, role: inviteRole, createdBy: admin.email })
  await AuditLogModel.create({
    action: 'user_invited',
    actor: admin.email,
    entityType: 'user',
    entityId: normalized,
    changes: [{ path: 'role', after: inviteRole }]
  })

  const appUrl = useRuntimeConfig().public.appUrl || ''
  return { inviteUrl: `${appUrl}/accept-invite?token=${token}`, email: normalized, role: inviteRole }
})
