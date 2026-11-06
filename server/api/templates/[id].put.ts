import { MessageTemplateModel } from '~~/server/models/MessageTemplate'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  await connectDb()
  const id = getRouterParam(event, 'id')
  const body = await readBody(event)

  const template = await MessageTemplateModel.findById(id)
  if (!template) throw createError({ statusCode: 404, statusMessage: 'Template not found' })

  if (typeof body.name === 'string' && body.name !== template.name) {
    const existing = await MessageTemplateModel.findOne({ name: body.name, _id: { $ne: id } })
    if (existing) {
      throw createError({ statusCode: 409, statusMessage: `A template named ${body.name} already exists` })
    }
    template.name = body.name
  }
  if (body.description !== undefined) template.description = typeof body.description === 'string' ? body.description : undefined
  if (body.subject !== undefined) template.subject = typeof body.subject === 'string' ? body.subject : ''
  if (body.bodyHtml !== undefined) template.bodyHtml = typeof body.bodyHtml === 'string' ? body.bodyHtml : ''
  template.updatedBy = user.email

  await template.save()
  return template
})
