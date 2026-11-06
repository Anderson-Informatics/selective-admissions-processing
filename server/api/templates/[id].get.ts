import { MessageTemplateModel } from '~~/server/models/MessageTemplate'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  await connectDb()
  const id = getRouterParam(event, 'id')
  const template = await MessageTemplateModel.findById(id).lean()
  if (!template) throw createError({ statusCode: 404, statusMessage: 'Template not found' })
  return template
})
