import { ResponseLibraryModel, type ResponseLibraryEntry } from '~~/server/models/ResponseLibrary'
import { sanitizeLibraryEntries, slugifyLibraryKey } from '~~/server/utils/responseLibrary'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  await connectDb()

  const body = await readBody(event)
  if (!body.name || typeof body.name !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'Library name is required' })
  }

  const existing = await ResponseLibraryModel.findOne({ name: body.name })
  if (existing) {
    throw createError({ statusCode: 409, statusMessage: `A library named ${body.name} already exists` })
  }

  const key = slugifyLibraryKey(typeof body.key === 'string' && body.key.trim() ? body.key : body.name)
  if (!key) throw createError({ statusCode: 400, statusMessage: 'Library key is required' })
  const keyExists = await ResponseLibraryModel.findOne({ key })
  if (keyExists) {
    throw createError({ statusCode: 409, statusMessage: `A library with key '${key}' already exists` })
  }

  return ResponseLibraryModel.create({
    name: body.name,
    key,
    description: typeof body.description === 'string' ? body.description : undefined,
    entries: sanitizeLibraryEntries(body.entries) as ResponseLibraryEntry[],
    createdBy: user.email,
    updatedBy: user.email
  })
})
