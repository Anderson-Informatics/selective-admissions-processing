import { previewEditingReminders, validateReminderInput } from '../../../utils/editingReminders'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  await connectDb()
  let input
  try {
    input = validateReminderInput(await readBody(event))
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'A cycle, template, and 1–100 submission IDs are required' })
  }
  try {
    const { previews, digest } = await previewEditingReminders(input)
    return { previews, digest }
  } catch {
    throw createError({ statusCode: 409, statusMessage: 'Unable to preview selected submissions. Check that initial applications are open, extraction is current, and the template has no unresolved fields.' })
  }
})
