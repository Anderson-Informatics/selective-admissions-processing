import { FieldMappingModel } from '~~/server/models/FieldMapping'

interface FieldRow {
  fieldId: string
  formFieldId: string
  label: string
  fieldType: string
  isRequired?: boolean
  subField?: string
  extractKey: string
  canonicalName: string
  mappingId?: string
  labelChanged?: boolean
  isAutoSuggested?: boolean
}

export default defineEventHandler(async (event) => {
  await connectDb()
  await requireAuth(event)

  const formId = getRouterParam(event, 'formId')
  if (!formId) {
    throw createError({ statusCode: 400, statusMessage: 'Form ID is required' })
  }

  const { cycleId } = getQuery(event) as { cycleId?: string }
  if (!cycleId) {
    throw createError({ statusCode: 400, statusMessage: 'cycleId is required' })
  }

  const [form, mappings] = await Promise.all([
    fetchForm(formId),
    FieldMappingModel.find({ cycleId, formId }).lean()
  ])

  const mappingByFieldId = mappings.reduce<Record<string, typeof mappings[number]>>((acc, m) => {
    acc[m.fieldId] = m
    return acc
  }, {})

  const rows: FieldRow[] = []
  let nameFieldCount = 1

  for (const f of form.fields) {
    if (f.fieldType === 'text_only' || f.fieldType === 'divider') {
      continue
    }

    if (f.fieldType === 'name') {
      rows.push(buildRow(f, 'firstName', nameFieldCount, `${f.label || 'Name'} - First Name`))
      rows.push(buildRow(f, 'lastName', nameFieldCount, `${f.label || 'Name'} - Last Name`))
      nameFieldCount += 1
    } else if (f.fieldType === 'address') {
      rows.push(buildRow(f, 'address1', undefined, `${f.label || 'Address'} - Address 1`))
      rows.push(buildRow(f, 'address2', undefined, `${f.label || 'Address'} - Address 2`))
      rows.push(buildRow(f, 'city', undefined, `${f.label || 'Address'} - City`))
      rows.push(buildRow(f, 'region', undefined, `${f.label || 'Address'} - State`))
      rows.push(buildRow(f, 'postalCode', undefined, `${f.label || 'Address'} - ZIP`))
      rows.push(buildRow(f, 'country', undefined, `${f.label || 'Address'} - Country`))
    } else {
      rows.push(buildRow(f, undefined, undefined, f.label))
    }
  }

  function buildRow(
    f: typeof form.fields[number],
    subField: string | undefined,
    nameIndex: number | undefined,
    label: string
  ): FieldRow {
    let fieldId: string
    let extractKey: string

    if (subField) {
      if (f.fieldType === 'name' && nameIndex !== undefined) {
        extractKey = `${subField}${nameIndex}`
      } else {
        extractKey = subField
      }
      fieldId = `${f.formFieldId}:${subField}`
    } else {
      extractKey = f.label || f.formFieldId
      fieldId = f.formFieldId
    }

    const mapping = mappingByFieldId[fieldId]
    const suggested = mapping ? undefined : guessCanonicalName(extractKey, label)

    return {
      fieldId,
      formFieldId: f.formFieldId,
      label,
      fieldType: f.fieldType,
      isRequired: f.isRequired,
      subField,
      extractKey,
      canonicalName: mapping?.canonicalName || suggested || '',
      mappingId: mapping?._id?.toString() || undefined,
      labelChanged: !!mapping && mapping.label !== label,
      isAutoSuggested: !mapping && !!suggested
    }
  }

  return {
    formId: form.formId,
    name: form.name,
    fields: rows
  }
})
