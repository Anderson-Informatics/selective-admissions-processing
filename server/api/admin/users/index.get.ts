import { UserModel } from '../../../models/User'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'site_admin')
  await connectDb()
  const users = await UserModel.find().select('email role status passwordResetRequestedAt lastLoginAt createdAt').sort({ email: 1 }).lean()
  return { users }
})
