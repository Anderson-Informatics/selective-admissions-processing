import { MessageTemplateModel } from '~~/server/models/MessageTemplate'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  await connectDb()

  const body = await readBody(event)
  if (!body.name || typeof body.name !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'Template name is required' })
  }

  const existing = await MessageTemplateModel.findOne({ name: body.name })
  if (existing) {
    throw createError({ statusCode: 409, statusMessage: `A template named ${body.name} already exists` })
  }

  return MessageTemplateModel.create({
    name: body.name,
    description: typeof body.description === 'string' ? body.description : undefined,
    subject: typeof body.subject === 'string' ? body.subject : '',
    bodyHtml: typeof body.bodyHtml === 'string' ? body.bodyHtml : '',
    createdBy: user.email,
    updatedBy: user.email
  })
})
