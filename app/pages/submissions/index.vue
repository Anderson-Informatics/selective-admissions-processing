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
  initialFormId?: string
}

interface Submission {
  _id: string
  submissionId: string
  applicationId: string
  status: string
  completedAt?: string
  createdBy?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mappedFields: Record<string, any>
  entryIds: string[]
  currentStageName?: string
  completedReviewCount: number
  geocode?: {
    status?: string
    lat?: number
    lng?: number
    address?: string
    formattedAddress?: string
    error?: string
    geocodedAt?: string
  }
  catchment?: {
    marygrove?: string
    checkedAt?: string
  }
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
  'submissions-applications',
  () => {
    if (!selectedCycleId.value) return Promise.resolve([])
    return requestFetch<Application[]>(`/api/applications?cycleId=${selectedCycleId.value}`)
  },
  { default: () => [] }
)

const ALL_APPLICATIONS = '__all__'

const applicationItems = computed<SelectItem[]>(() => [
  { label: 'All applications', value: ALL_APPLICATIONS },
  ...(applications.value || [])
    .map(a => ({ label: a.name, value: a._id }))
])

const selectedApplicationId = ref(ALL_APPLICATIONS)
const search = ref('')
const page = ref(1)
const limit = 25
const expanded = ref<Record<string, boolean>>({})

watch(selectedCycleId, () => {
  selectedApplicationId.value = ALL_APPLICATIONS
  page.value = 1
  expanded.value = {}
})

watch(selectedApplicationId, () => {
  page.value = 1
  refresh()
})

const { data, status, refresh } = useAsyncData<{
  submissions: Submission[]
  total: number
  page: number
  limit: number
}>(
  'submissions-list',
  () => {
    if (!selectedCycleId.value) {
      return Promise.resolve({ submissions: [], total: 0, page: 1, limit })
    }
    const params = new URLSearchParams()
    params.set('cycleId', selectedCycleId.value)
    params.set('page', String(page.value))
    params.set('limit', String(limit))
    if (selectedApplicationId.value !== ALL_APPLICATIONS) params.set('applicationId', selectedApplicationId.value)
    const q = search.value.trim()
    if (q) params.set('q', q)
    return requestFetch(`/api/submissions?${params.toString()}`)
  },
  {
    default: () => ({ submissions: [], total: 0, page: 1, limit }),
    watch: [selectedCycleId, page]
  }
)

function doSearch() {
  page.value = 1
  refresh()
}

const totalPages = computed(() => Math.ceil((data.value?.total || 0) / limit))

const modalOpen = ref(false)
const selectedSubmission = ref<Submission | null>(null)

function openSubmission(row: { original: Submission }) {
  selectedSubmission.value = row.original
  modalOpen.value = true
}

const mappedFieldEntries = computed(() => {
  if (!selectedSubmission.value) return []
  return Object.entries(selectedSubmission.value.mappedFields || {})
    .sort(([a], [b]) => a.localeCompare(b))
})

const catchmentLoading = ref(false)

function catchmentColor(value?: string) {
  if (value === 'Primary') return 'success'
  if (value === 'Secondary') return 'info'
  return 'neutral'
}

function geocodeStatusLabel(submission: Submission) {
  const status = submission.geocode?.status
  if (status === 'ok') return 'Geocoded'
  if (status === 'failed') return 'Failed'
  if (status === 'no_address') return 'No address'
  return 'Not checked'
}

async function runCatchmentLookup() {
  const submission = selectedSubmission.value
  if (!submission || !selectedCycleId.value) return
  catchmentLoading.value = true
  try {
    const res = await $fetch<{ geocode?: Submission['geocode'], catchment?: Submission['catchment'] }>(
      `/api/submissions/${submission.submissionId}/catchment`,
      { method: 'POST', query: { cycleId: selectedCycleId.value } }
    )
    submission.geocode = res.geocode
    submission.catchment = res.catchment
    toast.add({ title: 'Catchment lookup complete', color: 'success' })
  } catch (error: unknown) {
    const message = (error as { data?: { statusMessage?: string } }).data?.statusMessage || 'Catchment lookup failed'
    toast.add({ title: message, color: 'error' })
  } finally {
    catchmentLoading.value = false
  }
}

const columns = [
  { id: 'expand', header: '', enableSorting: false },
  { id: 'fullName', accessorFn: (row: Submission) => String(row.mappedFields?.FullName || ''), header: 'Full Name' },
  { id: 'firstName', accessorFn: (row: Submission) => String(row.mappedFields?.FirstName || ''), header: 'First Name' },
  { id: 'lastName', accessorFn: (row: Submission) => String(row.mappedFields?.LastName || ''), header: 'Last Name' },
  { id: 'currentStageName', accessorKey: 'currentStageName', header: 'Stage' },
  { id: 'status', accessorKey: 'status', header: 'Status' },
  { id: 'completed', accessorKey: 'completedAt', header: 'Completed' },
  { id: 'entries', accessorFn: (row: Submission) => row.entryIds?.length || 0, header: 'Entries' },
  { id: 'reviews', accessorFn: (row: Submission) => row.completedReviewCount || 0, header: 'Reviews' }
]
</script>

<template>
  <UContainer class="py-8">
    <h1 class="text-2xl font-semibold mb-6">
      Submissions
    </h1>

    <div class="flex flex-col sm:flex-row gap-4 mb-6 items-start">
      <UFormField label="Admission cycle" class="w-full sm:w-72">
        <USelect v-model="selectedCycleId" :items="(cycles || []).map(c => ({ label: `${c.year} — ${c.name}`, value: c._id }))" placeholder="Select a cycle" />
      </UFormField>

      <UFormField label="Application" class="w-full sm:w-96">
        <USelect v-model="selectedApplicationId" :items="applicationItems" placeholder="Filter by application" />
      </UFormField>

      <UFormField label="Search" class="w-full sm:w-80 sm:ml-auto">
        <form class="flex gap-2 w-full" @submit.prevent="doSearch">
          <UInput v-model="search" placeholder="Name, email, or submission ID" class="w-full" />
          <UButton type="submit" icon="i-lucide-search" color="neutral" />
        </form>
      </UFormField>
    </div>

    <p class="text-sm text-muted mb-2">
      Showing {{ data?.submissions.length || 0 }} of {{ data?.total || 0 }} submissions
    </p>

    <UTable
      v-model:expanded="expanded"
      :data="data?.submissions || []"
      :columns="columns"
      :loading="status === 'pending'"
      :on-select="(_, row) => openSubmission(row)"
      :get-row-id="(row: Submission) => row.submissionId"
      empty="No submissions found. Extract data from the Jobs page first."
      class="border rounded-lg mb-4"
    >
      <template #expand-cell="{ row }">
        <UButton
          variant="ghost"
          color="neutral"
          size="xs"
          :icon="row.getIsExpanded() ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
          @click="row.toggleExpanded()"
        />
      </template>

      <template #fullName-cell="{ row }">
        {{ row.original.mappedFields.FullName || '-' }}
      </template>

      <template #firstName-cell="{ row }">
        {{ row.original.mappedFields.FirstName || '-' }}
      </template>

      <template #lastName-cell="{ row }">
        {{ row.original.mappedFields.LastName || '-' }}
      </template>

      <template #currentStageName-cell="{ row }">
        {{ row.original.currentStageName || '-' }}
      </template>

      <template #status-cell="{ row }">
        {{ row.original.status }}
      </template>

      <template #completed-cell="{ row }">
        {{ row.original.completedAt ? new Date(row.original.completedAt).toLocaleDateString() : '-' }}
      </template>

      <template #entries-cell="{ row }">
        {{ row.original.entryIds?.length || 0 }}
      </template>

      <template #reviews-cell="{ row }">
        {{ row.original.completedReviewCount || 0 }}
      </template>

      <template #expanded="{ row }">
        <SubmissionReviews
          :cycle-id="selectedCycleId"
          :submission-id="row.original.submissionId"
        />
      </template>
    </UTable>

    <div v-if="data?.submissions.length" class="flex items-center justify-between">
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

    <UModal v-model:open="modalOpen" title="Submission details" description="Mapped fields from this submission." :ui="{ content: '!max-w-4xl' }">
      <template #body>
        <div v-if="selectedSubmission" class="space-y-4">
          <div class="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span class="text-muted">Submission ID:</span>
              {{ selectedSubmission.submissionId }}
            </div>
            <div>
              <span class="text-muted">Status:</span>
              {{ selectedSubmission.status }}
            </div>
            <div>
              <span class="text-muted">Completed:</span>
              {{ selectedSubmission.completedAt ? new Date(selectedSubmission.completedAt).toLocaleString() : '-' }}
            </div>
            <div>
              <span class="text-muted">Entries:</span>
              {{ selectedSubmission.entryIds?.length || 0 }}
            </div>
            <div>
              <span class="text-muted">Completed reviews:</span>
              {{ selectedSubmission.completedReviewCount || 0 }}
            </div>
          </div>

          <div class="border rounded-lg p-4 space-y-3">
            <div class="flex items-center justify-between">
              <h3 class="font-medium flex items-center gap-2">
                <UIcon name="i-lucide-map-pin" />
                Catchment
              </h3>
              <UButton
                size="xs"
                color="neutral"
                variant="outline"
                icon="i-lucide-refresh-cw"
                label="Run catchment lookup"
                :loading="catchmentLoading"
                @click="runCatchmentLookup"
              />
            </div>
            <div class="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span class="text-muted">Marygrove:</span>
                <UBadge
                  :label="selectedSubmission.catchment?.marygrove || 'Not checked'"
                  :color="catchmentColor(selectedSubmission.catchment?.marygrove)"
                  variant="subtle"
                />
              </div>
              <div>
                <span class="text-muted">Geocode:</span>
                {{ geocodeStatusLabel(selectedSubmission) }}
                <span
                  v-if="selectedSubmission.geocode?.lat != null && selectedSubmission.geocode?.lng != null"
                  class="text-muted"
                >
                  ({{ selectedSubmission.geocode.lat.toFixed(5) }}, {{ selectedSubmission.geocode.lng.toFixed(5) }})
                </span>
              </div>
              <div
                v-if="selectedSubmission.geocode?.formattedAddress || selectedSubmission.geocode?.address"
                class="col-span-2"
              >
                <span class="text-muted">Address:</span>
                {{ selectedSubmission.geocode.formattedAddress || selectedSubmission.geocode.address }}
              </div>
              <div
                v-if="selectedSubmission.geocode?.error"
                class="col-span-2 text-error"
              >
                {{ selectedSubmission.geocode.error }}
              </div>
            </div>
          </div>

          <div class="max-h-[50vh] overflow-y-auto border rounded-lg">
            <table class="w-full text-sm">
              <thead class="bg-muted text-left">
                <tr>
                  <th class="p-2 font-medium">
                    Field
                  </th>
                  <th class="p-2 font-medium">
                    Value
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="[key, value] in mappedFieldEntries" :key="key" class="border-t">
                  <td class="p-2 font-medium">
                    {{ key }}
                  </td>
                  <td class="p-2 text-muted whitespace-pre-wrap">
                    {{ value }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </template>

      <template #footer="{ close }">
        <UButton color="neutral" variant="outline" label="Close" @click="close" />
      </template>
    </UModal>
  </UContainer>
</template>
