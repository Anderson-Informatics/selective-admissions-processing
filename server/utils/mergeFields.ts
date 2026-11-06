export interface MergeFieldOption {
  value: string
  label: string
  questionText?: string
  fieldType?: string
  token?: string
}

export const LIST_FIELD_TYPES = new Set(['multiple_response', 'file_upload'])

export interface MergeFieldSource {
  key: string
  label: string
  kind: 'submission' | 'review' | 'builtin'
  stageName?: string
  fields: MergeFieldOption[]
}

const BUILTIN_FIELDS: MergeFieldOption[] = [
  { value: 'links.submission', label: 'Link to Submission' },
  { value: 'links.submissionForms', label: 'Link to Submission Forms Page' },
  { value: 'deadline', label: 'Deadline' }
]

interface MappingInput { formId: string, fieldId: string, label: string, canonicalName?: string }
interface FormInput { externalId: string, name?: string, data?: { fields?: unknown } }
interface StageInput { name: string, formId?: string, order?: number }
interface ApplicationInput { initialFormId?: string }

function sortOptions(options: Iterable<MergeFieldOption>): MergeFieldOption[] {
  return [...options].sort((a, b) => a.label.localeCompare(b.label))
}

export function buildFormFieldOptions(formId: string | undefined, mappings: MappingInput[], forms: FormInput[]): MergeFieldOption[] {
  if (!formId) return []
  const form = forms.find(item => item.externalId === formId)
  const formFields = new Map(formFieldList(form).map(field => [field.formFieldId, field]))
  const unique = new Map(mappings
    .filter(mapping => mapping.formId === formId && mapping.canonicalName)
    .map((mapping) => {
      const [fieldId, subField] = mapping.fieldId.split(':')
      const field = formFields.get(fieldId || '')
      const questionText = [field?.label, subField].filter(Boolean).join(' - ') || mapping.label
      const option: MergeFieldOption = { value: mapping.canonicalName!, label: mapping.canonicalName!, questionText }
      if (field?.fieldType && !subField) option.fieldType = field.fieldType
      return [mapping.canonicalName!, option]
    }))
  return sortOptions(unique.values())
}

interface FormFieldInput { formFieldId: string, label?: string, fieldType?: string, options?: Array<{ label?: string }> }

function formFieldList(form: FormInput | undefined): FormFieldInput[] {
  const fields = form?.data?.fields
  return Array.isArray(fields) ? fields as FormFieldInput[] : []
}

/** Canonical field name → known option labels, for multi-select fields. Used to split stored "A; B" strings safely. */
export function buildListOptionLabels(mappings: MappingInput[], forms: FormInput[]): Record<string, string[]> {
  const fieldsByForm = new Map(forms.map(form => [form.externalId, new Map(formFieldList(form).map(field => [field.formFieldId, field]))]))
  const result: Record<string, Set<string>> = {}
  for (const mapping of mappings) {
    if (!mapping.canonicalName || mapping.fieldId.includes(':')) continue
    const field = fieldsByForm.get(mapping.formId)?.get(mapping.fieldId)
    if (field?.fieldType !== 'multiple_response') continue
    const labels = (result[mapping.canonicalName] ||= new Set())
    for (const option of field.options || []) if (option.label) labels.add(option.label)
  }
  return Object.fromEntries(Object.entries(result).map(([name, labels]) => [name, [...labels]]))
}

export function buildMergeFieldSources(input: {
  applications: ApplicationInput[]
  stages: StageInput[]
  mappings: MappingInput[]
  forms: FormInput[]
  fallbackFields?: string[]
}): MergeFieldSource[] {
  const submissionFields = new Map<string, MergeFieldOption>()
  for (const formId of new Set(input.applications.map(app => app.initialFormId).filter(Boolean))) {
    for (const option of buildFormFieldOptions(formId, input.mappings, input.forms)) {
      if (!submissionFields.has(option.value)) submissionFields.set(option.value, option)
    }
  }
  if (!submissionFields.size) {
    for (const field of input.fallbackFields || []) submissionFields.set(field, { value: field, label: field })
  }

  const reviewSources = new Map<string, MergeFieldSource & { order: number }>()
  for (const stage of input.stages) {
    if (!stage.formId) continue
    const key = `${stage.name.trim().toLowerCase()}::${stage.formId}`
    const fields = buildFormFieldOptions(stage.formId, input.mappings, input.forms)
    const existing = reviewSources.get(key)
    if (existing) {
      const merged = new Map(existing.fields.map(field => [field.value, field]))
      for (const field of fields) if (!merged.has(field.value)) merged.set(field.value, field)
      existing.fields = sortOptions(merged.values())
      existing.order = Math.min(existing.order, stage.order ?? Infinity)
      continue
    }
    const formName = input.forms.find(form => form.externalId === stage.formId)?.name || 'Review form'
    reviewSources.set(key, {
      key: `review:${key}`,
      label: `${formName} (${stage.name})`,
      kind: 'review',
      stageName: stage.name,
      fields,
      order: stage.order ?? Infinity
    })
  }

  const sources: MergeFieldSource[] = [
    { key: 'submission', label: 'Submission', kind: 'submission', fields: sortOptions(submissionFields.values()) },
    ...[...reviewSources.values()]
      .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
      .map(({ order: _order, ...source }) => source),
    { key: 'builtin', label: 'Computed', kind: 'builtin', fields: BUILTIN_FIELDS }
  ]
  return sources.map(source => ({
    ...source,
    fields: source.fields.map(field => ({ ...field, token: mergeFieldToken(source, field.value) }))
  }))
}

export function mergeFieldToken(source: Pick<MergeFieldSource, 'kind' | 'stageName'>, field: string): string {
  return source.kind === 'review' && source.stageName ? `{{${source.stageName}.${field}}}` : `{{${field}}}`
}
