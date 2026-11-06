import { ResponseLibraryModel } from '~~/server/models/ResponseLibrary'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  await connectDb()
  const id = getRouterParam(event, 'id')
  const deleted = await ResponseLibraryModel.findByIdAndDelete(id)
  if (!deleted) throw createError({ statusCode: 404, statusMessage: 'Library not found' })
  return { ok: true }
})
