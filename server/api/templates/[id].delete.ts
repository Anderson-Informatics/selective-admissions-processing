import { MessageTemplateModel } from '~~/server/models/MessageTemplate'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  await connectDb()
  const id = getRouterParam(event, 'id')
  const deleted = await MessageTemplateModel.findByIdAndDelete(id)
  if (!deleted) throw createError({ statusCode: 404, statusMessage: 'Template not found' })
  return { deleted: true }
})
