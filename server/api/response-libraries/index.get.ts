import { ResponseLibraryModel } from '~~/server/models/ResponseLibrary'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  await connectDb()
  return ResponseLibraryModel.find().sort({ name: 1 }).lean()
})
