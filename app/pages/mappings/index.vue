<script setup lang="ts">
interface Cycle {
  _id: string
  year: string
  name: string
  active: boolean
}

interface FormItem {
  formId: string
  name: string
  applicationId: string
  applicationName: string
  type: 'initial' | 'review'
  stageNames: string[]
  mappableFieldCount: number
  mappedFieldCount: number
  isMapped: boolean
  isComplete: boolean
}

interface FormField {
  fieldId: string
  formFieldId?: string
  label: string
  fieldType: string
  isRequired?: boolean
  subField?: string
  extractKey?: string
  canonicalName: string
  mappingId?: string
  labelChanged?: boolean
  isAutoSuggested?: boolean
}

interface FormDetail {
  formId: string
  name: string
  fields: FormField[]
}

const toast = useToast()

const { data: cycles } = await useFetch<Cycle[]>('/api/cycles')
const selectedCycleId = ref('')

watchEffect(() => {
  const active = cycles.value?.find(c => c.active)
  if (active && !selectedCycleId.value) {
    selectedCycleId.value = active._id
  }
})

const requestFetch = useRequestFetch()
const { data: forms, status, refresh } = useAsyncData<FormItem[]>(
  'mapping-forms',
  () => selectedCycleId.value
    ? requestFetch<FormItem[]>(`/api/forms?cycleId=${selectedCycleId.value}`)
    : Promise.resolve([]),
  { default: () => [], watch: [selectedCycleId] }
)
const sortKey = ref<'application' | 'type'>('application')
const sortDirection = ref<'asc' | 'desc'>('asc')

const sortedForms = computed(() => [...(forms.value || [])].sort((a, b) => {
  const left = sortKey.value === 'application' ? a.applicationName : a.type
  const right = sortKey.value === 'application' ? b.applicationName : b.type
  const comparison = left.localeCompare(right)
  return sortDirection.value === 'asc' ? comparison : -comparison
}))

function toggleSort(key: 'application' | 'type') {
  if (sortKey.value === key) sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
  else {
    sortKey.value = key
    sortDirection.value = 'asc'
  }
}

function sortIndicator(key: 'application' | 'type') {
  if (sortKey.value !== key) return ''
  return sortDirection.value === 'asc' ? ' ↑' : ' ↓'
}

const { data: canonicalFields } = useFetch<string[]>('/api/canonical-fields')
const canonicalOptions = ref<string[]>([])

watch(() => canonicalFields.value, (value) => {
  if (value) {
    canonicalOptions.value = [...value]
  }
}, { immediate: true })

const modalOpen = ref(false)
const selectedFormId = ref('')
const selectedFormLabel = ref('')
const selectedApplicationName = ref('')
const formDetail = ref<FormDetail | null>(null)
const formStatus = ref('idle')
const saving = ref(false)

async function openForm(form: FormItem) {
  selectedFormId.value = form.formId
  selectedFormLabel.value = form.name
  selectedApplicationName.value = form.applicationName
  modalOpen.value = true
  formDetail.value = null
  formStatus.value = 'pending'

  try {
    formDetail.value = await $fetch<FormDetail>(`/api/forms/${form.formId}?cycleId=${selectedCycleId.value}`)
  } catch (err: unknown) {
    const message = (err as { data?: { statusMessage?: string } }).data?.statusMessage
    toast.add({
      title: message || 'Failed to load form',
      color: 'error'
    })
  } finally {
    formStatus.value = 'idle'
  }
}

function addCanonical(value: string, field: FormField) {
  const trimmed = value.trim()
  if (trimmed && !canonicalOptions.value.includes(trimmed)) {
    canonicalOptions.value.push(trimmed)
  }
  field.canonicalName = trimmed
}

const unmappedCount = computed(() =>
  formDetail.value?.fields.filter(f => !f.canonicalName).length || 0
)

async function saveMappings() {
  if (!formDetail.value || !selectedCycleId.value) return
  saving.value = true

  const mappings = formDetail.value.fields.map(f => ({
    fieldId: f.fieldId,
    label: f.label,
    canonicalName: f.canonicalName
  }))

  try {
    await $fetch(`/api/forms/${selectedFormId.value}/mappings`, {
      method: 'POST',
      body: {
        cycleId: selectedCycleId.value,
        mappings
      }
    })
    toast.add({ title: 'Mappings saved', color: 'success' })
    await refresh()
    modalOpen.value = false
  } catch (err: unknown) {
    const message = (err as { data?: { statusMessage?: string } }).data?.statusMessage
    toast.add({
      title: message || 'Failed to save mappings',
      color: 'error'
    })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UContainer class="py-8">
    <h1 class="text-2xl font-semibold mb-6">
      Form Field Mappings
    </h1>

    <UFormField label="Admission cycle" class="mb-6">
      <USelect v-model="selectedCycleId" :items="(cycles || []).map(c => ({ label: `${c.year} — ${c.name}`, value: c._id }))" placeholder="Select a cycle" class="w-72" />
    </UFormField>

    <div v-if="status === 'pending'" class="text-muted py-8 text-center">
      Loading forms...
    </div>

    <div v-else-if="!forms?.length" class="text-muted py-8 text-center">
      No applications/forms mapped for this cycle yet. Map applications first.
    </div>

    <div v-else class="max-h-[60vh] overflow-y-auto border rounded-lg">
      <table class="w-full text-sm">
        <thead class="bg-muted text-left sticky top-0">
          <tr>
            <th class="p-2 font-medium">
              <button type="button" class="hover:text-primary" @click="toggleSort('application')">
                Application{{ sortIndicator('application') }}
              </button>
            </th>
            <th class="p-2 font-medium">
              Form
            </th>
            <th class="p-2 font-medium">
              <button type="button" class="hover:text-primary" @click="toggleSort('type')">
                Type{{ sortIndicator('type') }}
              </button>
            </th>
            <th class="p-2 font-medium">
              Stage(s)
            </th>
            <th class="p-2 font-medium">
              Mapped
            </th>
            <th class="p-2 font-medium">
              Status
            </th>
            <th class="p-2 font-medium">
              Action
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="form in sortedForms" :key="form.formId" class="border-t">
            <td class="p-2">
              {{ form.applicationName }}
            </td>
            <td class="p-2">
              {{ form.name }}
            </td>
            <td class="p-2 text-muted capitalize">
              {{ form.type }}
            </td>
            <td class="p-2 text-muted">
              {{ form.stageNames?.length ? form.stageNames.join(', ') : 'Initial application' }}
            </td>
            <td class="p-2 text-muted">
              {{ form.mappedFieldCount }} / {{ form.mappableFieldCount }}
            </td>
            <td class="p-2">
              <UBadge
                v-if="form.isComplete"
                label="complete"
                color="success"
                variant="soft"
                size="sm"
              />
              <UBadge
                v-else-if="form.isMapped"
                label="partial"
                color="warning"
                variant="soft"
                size="sm"
              />
              <UBadge
                v-else
                label="not mapped"
                color="error"
                variant="soft"
                size="sm"
              />
            </td>
            <td class="p-2">
              <UButton
                icon="i-lucide-pencil"
                color="neutral"
                variant="ghost"
                aria-label="Map fields"
                @click="openForm(form)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <UModal v-model:open="modalOpen" :title="`${selectedApplicationName} — ${selectedFormLabel}`" description="Map each form field label to a canonical application field." :ui="{ content: '!max-w-4xl' }">
      <template #body>
        <div v-if="formStatus === 'pending'" class="text-muted py-8 text-center">
          Loading form fields...
        </div>

        <div v-else-if="formDetail" class="space-y-4">
          <UAlert
            v-if="unmappedCount > 0"
            color="warning"
            variant="soft"
            :title="`${unmappedCount} unmapped field${unmappedCount === 1 ? '' : 's'} remaining`"
          />

          <div class="max-h-[60vh] overflow-y-auto border rounded-lg">
            <table class="w-full text-sm">
              <thead class="bg-muted text-left">
                <tr>
                  <th class="p-2 font-medium">
                    Field label
                  </th>
                  <th class="p-2 font-medium">
                    Type
                  </th>
                  <th class="p-2 font-medium w-64">
                    Canonical name
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="field in formDetail.fields" :key="field.fieldId" class="border-t">
                  <td class="p-2">
                    <span :class="{ 'text-warning': field.labelChanged }">{{ field.label }}</span>
                    <UBadge v-if="field.isAutoSuggested" label="suggested" color="info" variant="soft" size="sm" class="ml-2" />
                    <span v-if="field.labelChanged" class="ml-2 text-xs text-warning">changed</span>
                  </td>
                  <td class="p-2 text-muted">
                    {{ field.fieldType }}
                  </td>
                  <td class="p-2">
                    <USelectMenu
                      v-model="field.canonicalName"
                      :items="canonicalOptions"
                      create-item
                      search-input
                      placeholder="Select or type..."
                      class="w-full"
                      @create="(value: string) => addCanonical(value, field)"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </template>

      <template #footer="{ close }">
        <UButton color="neutral" variant="outline" label="Cancel" @click="close" />
        <UButton label="Save mappings" :loading="saving" :disabled="!formDetail" @click="saveMappings" />
      </template>
    </UModal>
  </UContainer>
</template>
