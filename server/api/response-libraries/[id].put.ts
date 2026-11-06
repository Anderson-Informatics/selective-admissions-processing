import { ResponseLibraryModel } from '~~/server/models/ResponseLibrary'
import { sanitizeLibraryEntries, slugifyLibraryKey } from '~~/server/utils/responseLibrary'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  await connectDb()
  const id = getRouterParam(event, 'id')
  const body = await readBody(event)

  const library = await ResponseLibraryModel.findById(id)
  if (!library) throw createError({ statusCode: 404, statusMessage: 'Library not found' })

  if (typeof body.name === 'string' && body.name !== library.name) {
    const existing = await ResponseLibraryModel.findOne({ name: body.name, _id: { $ne: id } })
    if (existing) {
      throw createError({ statusCode: 409, statusMessage: `A library named ${body.name} already exists` })
    }
    library.name = body.name
  }
  if (typeof body.key === 'string') {
    const key = slugifyLibraryKey(body.key)
    if (!key) throw createError({ statusCode: 400, statusMessage: 'Library key is required' })
    if (key !== library.key) {
      const keyExists = await ResponseLibraryModel.findOne({ key, _id: { $ne: id } })
      if (keyExists) {
        throw createError({ statusCode: 409, statusMessage: `A library with key '${key}' already exists` })
      }
      library.key = key
    }
  }
  if (body.description !== undefined) library.description = typeof body.description === 'string' ? body.description : undefined
  if (body.entries !== undefined) library.entries = sanitizeLibraryEntries(body.entries)
  library.updatedBy = user.email

  await library.save()
  return library
})
