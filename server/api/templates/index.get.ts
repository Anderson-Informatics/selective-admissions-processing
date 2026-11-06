import { MessageTemplateModel } from '~~/server/models/MessageTemplate'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  await connectDb()
  return MessageTemplateModel.find().sort({ name: 1 }).lean()
})
