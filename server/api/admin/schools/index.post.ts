import { isValidObjectId } from 'mongoose'
import { SchoolModel } from '../../../models/School'
import { auditDirectory, schoolKey, schoolSchema } from '../../../utils/schoolDirectory'

export default defineEventHandler(async (event) => {
  const user = await requireRole(event, 'site_admin')
  await connectDb()
  const body = await readBody(event)
  const parsed = schoolSchema.safeParse(body)
  if (!parsed.success || (body.id && !isValidObjectId(body.id))) throw createError({ statusCode: 400, statusMessage: 'Invalid school configuration' })
  const matchKeys = [...new Set([parsed.data.name, ...parsed.data.aliases].map(schoolKey))]
  const conflict = await SchoolModel.findOne({ matchKeys: { $in: matchKeys }, ...(body.id ? { _id: { $ne: body.id } } : {}) }).lean()
  if (conflict) throw createError({ statusCode: 409, statusMessage: `School name or alias already belongs to ${conflict.name}` })
  const before = body.id ? await SchoolModel.findById(body.id).lean() : null
  if (body.id && !before) throw createError({ statusCode: 404, statusMessage: 'School not found' })
  const data = { ...parsed.data, matchKeys }
  const school = body.id ? await SchoolModel.findByIdAndUpdate(body.id, { $set: data }, { new: true }) : await SchoolModel.create(data)
  await auditDirectory(user.email, 'school', String(school!._id), before, school!.toObject())
  return school
})
