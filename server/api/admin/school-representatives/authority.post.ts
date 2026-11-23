import { isValidObjectId } from 'mongoose'
import { ApplicationModel } from '../../../models/Application'
import { CycleModel } from '../../../models/Cycle'
import { SchoolModel } from '../../../models/School'
import { SchoolRepresentativeModel } from '../../../models/SchoolRepresentative'
import { SchoolAuthorityModel } from '../../../models/SchoolAuthority'
import { auditDirectory, authoritySchema } from '../../../utils/schoolDirectory'

export default defineEventHandler(async (event) => {
  const user = await requireRole(event, 'site_admin')
  await connectDb()
  const parsed = authoritySchema.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid authority configuration' })
  const { userId, ...scope } = parsed.data
  if (![scope.cycleId, scope.schoolId, ...(scope.applicationId ? [scope.applicationId] : [])].every(isValidObjectId)) throw createError({ statusCode: 400, statusMessage: 'Invalid scope IDs' })
  if (!await CycleModel.exists({ _id: scope.cycleId }) || !await SchoolModel.exists({ _id: scope.schoolId, active: true })) throw createError({ statusCode: 400, statusMessage: 'Unknown cycle or active school' })
  if (scope.applicationId && !await ApplicationModel.exists({ _id: scope.applicationId, cycleId: scope.cycleId })) throw createError({ statusCode: 400, statusMessage: 'Application does not belong to cycle' })
  if (!await SchoolRepresentativeModel.exists({ userId, schoolIds: scope.schoolId, active: true })) throw createError({ statusCode: 400, statusMessage: 'Primary user must be an active school representative' })
  const before = await SchoolAuthorityModel.findOne(scope).lean()
  const authority = await SchoolAuthorityModel.findOneAndUpdate(scope, { $set: { userId }, $inc: { version: 1 } }, { upsert: true, new: true })
  await auditDirectory(user.email, 'school_authority', String(authority!._id), before, authority!.toObject(), scope.cycleId)
  return authority
})
