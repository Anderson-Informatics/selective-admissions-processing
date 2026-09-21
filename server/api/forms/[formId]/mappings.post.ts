import { FieldMappingModel } from '~~/server/models/FieldMapping'

export default defineEventHandler(async (event) => {
  await connectDb()
  await requireAuth(event)

  const formId = getRouterParam(event, 'formId')
  if (!formId) {
    throw createError({ statusCode: 400, statusMessage: 'Form ID is required' })
  }

  const body = await readBody(event)

  if (!body.cycleId || !Array.isArray(body.mappings)) {
    throw createError({ statusCode: 400, statusMessage: 'cycleId and mappings are required' })
  }

  await FieldMappingModel.deleteMany({ cycleId: body.cycleId, formId })

  const docs = body.mappings
    .filter((m: any) => m.fieldId && m.label && m.canonicalName)
    .map((m: any) => ({
      cycleId: body.cycleId,
      formId,
      fieldId: m.fieldId,
      label: m.label,
      canonicalName: m.canonicalName,
      transform: m.transform || ''
    }))

  if (docs.length) {
    await FieldMappingModel.insertMany(docs)
  }

  return { ok: true, saved: docs.length }
})
