import { SchoolModel } from '../../../models/School'
import { MetadataModel } from '../../../models/Metadata'
import { SchoolRepresentativeModel } from '../../../models/SchoolRepresentative'
import { auditDirectory, representativeSchema } from '../../../utils/schoolDirectory'
import { isValidObjectId } from 'mongoose'

export default defineEventHandler(async (event) => {
  const user = await requireRole(event, 'site_admin')
  await connectDb()
  const parsed = representativeSchema.safeParse(await readBody(event))
  if (!parsed.success || parsed.data.schoolIds.some(id => !isValidObjectId(id))) throw createError({ statusCode: 400, statusMessage: 'Invalid representative configuration' })
  const data = parsed.data
  const before = await SchoolRepresentativeModel.findOne({ userId: data.userId }).lean()
  if (!before && !await MetadataModel.exists({ type: 'team', externalId: data.userId })) throw createError({ statusCode: 400, statusMessage: 'Select a synced Submittable member' })
  if (await SchoolModel.countDocuments({ _id: { $in: data.schoolIds } }) !== data.schoolIds.length) throw createError({ statusCode: 400, statusMessage: 'Unknown school' })
  const representative = await SchoolRepresentativeModel.findOneAndUpdate({ userId: data.userId }, { $set: data }, { upsert: true, new: true })
  await auditDirectory(user.email, 'school_representative', data.userId, before, representative!.toObject())
  return representative
})
