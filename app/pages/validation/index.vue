<script setup lang="ts">
import type { SelectItem } from '@nuxt/ui'

interface Cycle {
  _id: string
  year: string
  name: string
  active: boolean
}

interface Application {
  _id: string
  name: string
  type: string
}

interface ValidationIssue {
  _id: string
  submissionId: string
  fullName: string
  applicationId?: string
  type: string
  severity: 'error' | 'warning' | 'info'
  field?: string
  message: string
  status: 'open' | 'resolved'
  resolution?: 'auto' | 'override'
  resolvedBy?: string
  resolvedAt?: string
  createdAt: string
  updatedAt: string
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
const { data: applications } = useAsyncData<Application[]>(
  'validation-applications',
  () => {
    if (!selectedCycleId.value) return Promise.resolve([])
    return requestFetch<Application[]>(`/api/applications?cycleId=${selectedCycleId.value}`)
  },
  { default: () => [], watch: [selectedCycleId] }
)

const ALL_APPLICATIONS = '__all__'
const ALL_SEVERITY = '__all__'
const ALL_STATUS = '__all__'

const applicationItems = computed<SelectItem[]>(() => [
  { label: 'All applications', value: ALL_APPLICATIONS },
  ...(applications.value || []).map(a => ({ label: a.name, value: a._id }))
])

const selectedApplicationId = ref(ALL_APPLICATIONS)
const selectedSeverity = ref(ALL_SEVERITY)
const selectedStatus = ref(ALL_STATUS)
const search = ref('')
const page = ref(1)
const limit = 25

watch(selectedCycleId, () => {
  selectedApplicationId.value = ALL_APPLICATIONS
  selectedSeverity.value = ALL_SEVERITY
  selectedStatus.value = ALL_STATUS
  page.value = 1
  search.value = ''
})

watch([selectedApplicationId, selectedSeverity, selectedStatus], () => {
  page.value = 1
  refresh()
})

const { data, status, refresh } = useAsyncData<{
  issues: ValidationIssue[]
  total: number
  page: number
  limit: number
}>(
  'validation-issues',
  () => {
    if (!selectedCycleId.value) {
      return Promise.resolve({ issues: [], total: 0, page: 1, limit })
    }
    const params = new URLSearchParams()
    params.set('cycleId', selectedCycleId.value)
    params.set('page', String(page.value))
    params.set('limit', String(limit))
    if (selectedApplicationId.value !== ALL_APPLICATIONS) params.set('applicationId', selectedApplicationId.value)
    if (selectedSeverity.value !== ALL_SEVERITY) params.set('severity', selectedSeverity.value)
    if (selectedStatus.value !== ALL_STATUS) params.set('status', selectedStatus.value)
    const q = search.value.trim()
    if (q) params.set('q', q)
    return requestFetch(`/api/validation?${params.toString()}`)
  },
  {
    default: () => ({ issues: [], total: 0, page: 1, limit }),
    watch: [selectedCycleId, page]
  }
)

function doSearch() {
  page.value = 1
  refresh()
}

const resolving = reactive(new Set<string>())

async function resolveIssue(issueId: string) {
  resolving.add(issueId)
  try {
    await $fetch(`/api/validation/${issueId}/resolve`, { method: 'POST' })
    toast.add({ title: 'Issue marked as resolved', color: 'success' })
    await refresh()
  } catch (error: unknown) {
    const message = (error as { data?: { statusMessage?: string } }).data?.statusMessage || 'Failed to resolve issue'
    toast.add({ title: message, color: 'error' })
  } finally {
    resolving.delete(issueId)
  }
}

const totalPages = computed(() => Math.ceil((data.value?.total || 0) / limit))

function severityColor(severity: string) {
  if (severity === 'error') return 'error'
  if (severity === 'warning') return 'warning'
  return 'info'
}

const columns = [
  { id: 'submission', accessorKey: 'fullName', header: 'Submission' },
  { id: 'type', accessorKey: 'type', header: 'Type' },
  { id: 'severity', accessorKey: 'severity', header: 'Severity' },
  { id: 'message', accessorKey: 'message', header: 'Message' },
  { id: 'status', accessorKey: 'status', header: 'Status' },
  { id: 'updatedAt', accessorKey: 'updatedAt', header: 'Updated' },
  { id: 'actions', header: 'Actions', enableSorting: false }
]

function statusLabel(issue: ValidationIssue) {
  if (issue.status !== 'resolved') return issue.status
  if (issue.resolution === 'override') return 'resolved (override)'
  if (issue.resolution === 'auto') return 'resolved (auto)'
  return 'resolved'
}

function statusColor(issue: ValidationIssue) {
  if (issue.status !== 'resolved') return 'error'
  if (issue.resolution === 'override') return 'warning'
  return 'success'
}
</script>

<template>
  <UContainer class="py-8">
    <h1 class="text-2xl font-semibold mb-6">
      Validation issues
    </h1>

    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
      <UFormField label="Admission cycle">
        <USelect
          v-model="selectedCycleId"
          :items="(cycles || []).map(c => ({ label: `${c.year} — ${c.name}`, value: c._id }))"
          placeholder="Select a cycle"
          class="w-full"
        />
      </UFormField>

      <UFormField label="Application">
        <USelect
          v-model="selectedApplicationId"
          :items="applicationItems"
          placeholder="Filter by application"
          class="w-full"
        />
      </UFormField>

      <UFormField label="Severity">
        <USelect
          v-model="selectedSeverity"
          :items="[
            { label: 'All', value: ALL_SEVERITY },
            { label: 'Error', value: 'error' },
            { label: 'Warning', value: 'warning' },
            { label: 'Info', value: 'info' }
          ]"
          class="w-full"
        />
      </UFormField>

      <UFormField label="Status">
        <USelect
          v-model="selectedStatus"
          :items="[
            { label: 'All', value: ALL_STATUS },
            { label: 'Open', value: 'open' },
            { label: 'Resolved', value: 'resolved' }
          ]"
          class="w-full"
        />
      </UFormField>

      <UFormField label="Search">
        <form class="flex gap-2 w-full" @submit.prevent="doSearch">
          <UInput v-model="search" placeholder="Submission, type, or message" class="w-full" />
          <UButton type="submit" icon="i-lucide-search" color="neutral" />
        </form>
      </UFormField>
    </div>

    <p class="text-sm text-muted mb-2">
      Showing {{ data?.issues.length || 0 }} of {{ data?.total || 0 }} issues
    </p>

    <UTable
      :data="data?.issues || []"
      :columns="columns"
      :loading="status === 'pending'"
      empty="No validation issues found. Run validation from the Jobs page to populate issues."
      class="border rounded-lg mb-4"
    >
      <template #submission-cell="{ row }">
        <a
          :href="`https://dpscd.submittable.com/submissions/${row.original.submissionId}`"
          target="_blank"
          rel="noopener noreferrer"
          class="text-sm font-medium hover:underline"
        >
          {{ row.original.fullName }}
        </a>
      </template>

      <template #type-cell="{ row }">
        <span class="text-sm">{{ row.original.type }}</span>
      </template>

      <template #severity-cell="{ row }">
        <UBadge :label="row.original.severity" :color="severityColor(row.original.severity)" variant="subtle" />
      </template>

      <template #message-cell="{ row }">
        <div class="max-w-52 text-xs whitespace-normal break-words leading-snug">
          {{ row.original.message }}
        </div>
      </template>

      <template #status-cell="{ row }">
        <UBadge :label="statusLabel(row.original)" :color="statusColor(row.original)" variant="subtle" />
      </template>

      <template #updatedAt-cell="{ row }">
        <span class="text-sm text-muted">{{ row.original.updatedAt ? new Date(row.original.updatedAt).toLocaleString() : '—' }}</span>
      </template>

      <template #actions-cell="{ row }">
        <UButton
          v-if="row.original.status === 'open'"
          size="xs"
          color="neutral"
          variant="outline"
          label="Mark resolved"
          :loading="resolving.has(row.original._id)"
          @click="resolveIssue(row.original._id)"
        />
      </template>
    </UTable>

    <div v-if="data?.issues.length" class="flex items-center justify-between">
      <UButton
        color="neutral"
        variant="outline"
        :disabled="page <= 1"
        @click="page--"
      >
        Previous
      </UButton>
      <span class="text-sm text-muted">
        Page {{ data.page }} of {{ totalPages }}
      </span>
      <UButton
        color="neutral"
        variant="outline"
        :disabled="page >= totalPages"
        @click="page++"
      >
        Next
      </UButton>
    </div>
  </UContainer>
</template>
