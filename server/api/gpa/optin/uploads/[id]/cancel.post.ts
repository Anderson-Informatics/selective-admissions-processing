import { Types } from 'mongoose'
import { GpaUploadModel } from '~~/server/models/GpaUpload'

export default defineEventHandler(async (event) => {
  await connectDb()
  const user = await requireAuth(event)
  const id = getRouterParam(event, 'id')
  if (!id || !Types.ObjectId.isValid(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid upload ID' })

  const upload = await GpaUploadModel.findOneAndUpdate(
    { _id: id, createdBy: user.email, source: 'opt_in', status: 'ready' },
    { $set: { status: 'cancelled', files: [], expiresAt: new Date(Date.now() + 60_000) } },
    { returnDocument: 'after' }
  ).lean()
  if (!upload) throw createError({ statusCode: 409, statusMessage: 'Only an unconfirmed upload can be cancelled' })

  return { cancelled: true }
})
