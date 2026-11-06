import { ResponseLibraryModel } from '~~/server/models/ResponseLibrary'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  await connectDb()
  const id = getRouterParam(event, 'id')
  const library = await ResponseLibraryModel.findById(id).lean()
  if (!library) throw createError({ statusCode: 404, statusMessage: 'Library not found' })
  return library
})
