import { AuthTokenModel } from '../../../models/AuthToken'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'site_admin')
  await connectDb()
  const invites = await AuthTokenModel.find({
    type: 'invite',
    consumedAt: { $exists: false },
    expiresAt: { $gt: new Date() }
  }).select('email role createdBy expiresAt createdAt').sort({ createdAt: -1 }).lean()
  return { invites }
})
