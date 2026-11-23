<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { IepRosterRow } from '~~/server/utils/iepRostering'

interface Cycle { _id: string, name: string, year: string, active: boolean }
interface RosterData {
  sessions: Array<{ labelId: string, name: string, count: number }>
  rows: IepRosterRow[]
  groups: Array<{ name: string, count: number }>
  diagnostics: string[]
  generatedAt: string
}
const { data: cycles } = await useFetch<Cycle[]>('/api/cycles')
const selectedCycleId = ref('')
const selectedSessionId = ref<string>()
watchEffect(() => {
  if (!selectedCycleId.value) selectedCycleId.value = cycles.value?.find(cycle => cycle.active)?._id || ''
})
const cycleItems = computed(() => (cycles.value || []).map(cycle => ({ label: `${cycle.year} — ${cycle.name}`, value: cycle._id })))
const roster = ref<RosterData | null>(null)
const loading = ref(false)
const errorMessage = ref('')
const search = ref('')
const selectedGroup = ref('')
let requestId = 0
const requestFetch = useRequestFetch()
async function loadRoster() {
  const id = ++requestId
  const cycleId = selectedCycleId.value
  const sessionLabelId = selectedSessionId.value
  roster.value = null
  selectedGroup.value = ''
  errorMessage.value = ''
  if (!cycleId) {
    loading.value = false
    return
  }
  loading.value = true
  try {
    const result = await requestFetch<RosterData>('/api/iep-roster', { query: { cycleId, ...(sessionLabelId ? { sessionLabelId } : {}) } })
    if (id === requestId) roster.value = result
  } catch (error: unknown) {
    if (id === requestId) errorMessage.value = (error as { data?: { statusMessage?: string } }).data?.statusMessage || 'Could not load roster.'
  } finally {
    if (id === requestId) loading.value = false
  }
}
watch(selectedCycleId, () => {
  selectedSessionId.value = undefined
  search.value = ''
  loadRoster()
}, { immediate: true })
watch(selectedSessionId, () => {
  search.value = ''
  loadRoster()
})
const sessionItems = computed(() => (roster.value?.sessions || []).map(session => ({ label: `${session.name} (${session.count})`, value: session.labelId })))
const filteredRows = computed(() => (roster.value?.rows || []).filter(row =>
  (!selectedGroup.value || row.finalGroup === selectedGroup.value)
  && `${row.fullName} ${row.submissionIdInt || ''} ${row.finalGroup}`.toLowerCase().includes(search.value.toLowerCase())
))
const columns: TableColumn<IepRosterRow>[] = [
  { accessorKey: 'fullName', header: 'Student' },
  { accessorKey: 'submissionIdInt', header: 'Submission #' },
  { accessorKey: 'type', header: 'Type' },
  { accessorKey: 'completeDocuments', header: 'Complete documents', cell: ({ row }) => row.original.completeDocuments || 'Unknown' },
  { accessorKey: 'finalGroup', header: 'Suggested subgroup' },
  { accessorKey: 'accommodations', header: 'Accommodations' },
  { accessorKey: 'otherAccommodations', header: 'Other accommodations' },
  { accessorKey: 'parentPhone', header: 'Parent phone' },
  { id: 'warnings', header: 'Notices / review needed' }
]
const downloading = ref('')
const toast = useToast()
async function download(format: 'docx' | 'grouped-docx' | 'xlsx' | 'zip', allDays = false) {
  const cycleId = selectedCycleId.value
  const sessionLabelId = selectedSessionId.value
  if (!cycleId || (!allDays && !sessionLabelId)) return
  downloading.value = allDays ? 'all' : format
  try {
    const response = await $fetch.raw<Blob>('/api/iep-roster/export', {
      query: { cycleId, scope: allDays ? 'all' : 'day', format, ...(!allDays ? { sessionLabelId } : {}) },
      responseType: 'blob'
    })
    if (!response._data) return
    const url = URL.createObjectURL(response._data)
    const link = document.createElement('a')
    link.href = url
    const filename = response.headers.get('Content-Disposition')?.split('filename*=UTF-8\'\'')[1]
    link.download = filename ? decodeURIComponent(filename) : `iep-roster.${format}`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast.add({ title: 'Roster downloaded', color: 'success' })
  } catch (error: unknown) {
    const data = (error as { data?: Blob | { statusMessage?: string } }).data
    let message = 'Roster download failed.'
    if (data instanceof Blob) {
      try {
        message = JSON.parse(await data.text()).statusMessage || message
      } catch {
        message = 'Roster download failed.'
      }
    } else message = data?.statusMessage || message
    toast.add({ title: message, color: 'error' })
  } finally {
    downloading.value = ''
  }
}
</script>

<template>
  <UContainer class="space-y-6 py-8">
    <PageHeader
      title="IEP / 504 / MLL Rostering"
      help="iepRostering"
    >
      <template #actions>
        <USelect
          v-model="selectedCycleId"
          :items="cycleItems"
          aria-label="Cycle"
          class="w-64"
          placeholder="Select cycle"
        />
      </template>
    </PageHeader>
    <UAlert
      title="Current synced data · reporting only"
      description="Rosters include labeled IEP/504/MLL students from 9th Grade and Current HS applications only, even with incomplete reviews or no accommodations required. Downloads regenerate from current synced data; no messages are sent and no scheduling or labels are changed."
      color="info"
      variant="subtle"
    />
    <div class="flex flex-wrap items-center gap-3">
      <USelect
        v-model="selectedSessionId"
        :items="sessionItems"
        :disabled="loading || !roster?.sessions.length"
        aria-label="Test day"
        placeholder="Select test day"
        class="w-72"
      />
      <UButton
        label="Refresh"
        color="neutral"
        variant="outline"
        :loading="loading"
        :disabled="!selectedCycleId"
        @click="loadRoster"
      />
      <UButton
        label="Download All Days ZIP"
        :disabled="loading || !roster?.sessions.length || !!downloading"
        :loading="downloading === 'all'"
        @click="download('zip', true)"
      />
    </div>
    <UAlert
      v-if="errorMessage"
      title="Roster unavailable"
      :description="errorMessage"
      color="error"
    />
    <UCard v-if="roster?.diagnostics.length">
      <template #header>
        <h2 class="font-semibold">
          Data checks
        </h2>
      </template>
      <ul class="list-disc space-y-1 pl-5 text-sm">
        <li
          v-for="diagnostic in roster.diagnostics"
          :key="diagnostic"
        >
          {{ diagnostic }}
        </li>
      </ul>
    </UCard>
    <p
      v-if="loading"
      role="status"
      class="text-muted"
    >
      Loading roster…
    </p>
    <p
      v-else-if="roster && !roster.sessions.length"
      class="text-muted"
    >
      No non-withdrawn IEP/504/MLL students have a test-day label in this cycle.
    </p>
    <p
      v-else-if="roster && !selectedSessionId"
      class="text-muted"
    >
      Select a test day to preview the roster, or download all days.
    </p>
    <template v-if="roster && selectedSessionId && !loading">
      <div class="flex flex-wrap gap-3">
        <UButton
          label="Word cards"
          :disabled="!roster.rows.length || !!downloading"
          :loading="downloading === 'docx'"
          @click="download('docx')"
        />
        <UButton
          label="Word Grouped Roster"
          :disabled="!roster.rows.length || !!downloading"
          :loading="downloading === 'grouped-docx'"
          @click="download('grouped-docx')"
        />
        <UButton
          label="Excel roster"
          :disabled="!roster.rows.length || !!downloading"
          :loading="downloading === 'xlsx'"
          @click="download('xlsx')"
        />
        <UButton
          label="Download Selected Day ZIP"
          color="neutral"
          variant="outline"
          :disabled="!roster.rows.length || !!downloading"
          :loading="downloading === 'zip'"
          @click="download('zip')"
        />
      </div>
      <UCard>
        <template #header>
          <h2 class="font-semibold">
            Suggested accommodation subgroups · {{ roster.rows.length }} students
          </h2>
        </template>
        <p class="mb-3 text-sm text-muted">
          These are not Exam Scheduling arrival groups or saved room assignments. Legacy total limits are 7 for “less than 5” and 12 for “less than 10”; overlapping needs require staff review.
        </p>
        <div class="flex flex-wrap gap-2">
          <UButton
            v-for="group in roster.groups"
            :key="group.name"
            :color="selectedGroup === group.name ? 'primary' : 'neutral'"
            :variant="selectedGroup === group.name ? 'solid' : 'subtle'"
            size="xs"
            :aria-pressed="selectedGroup === group.name"
            @click="selectedGroup = selectedGroup === group.name ? '' : group.name"
          >
            {{ group.name }}: {{ group.count }}
          </UButton>
        </div>
      </UCard>
      <UInput
        v-model="search"
        placeholder="Search student, ID, or subgroup"
        aria-label="Search roster"
        class="w-80"
      />
      <p
        role="status"
        class="text-sm text-muted"
      >
        Showing {{ filteredRows.length }} of {{ roster.rows.length }} students<span v-if="selectedGroup"> · {{ selectedGroup }}</span>.
        Click a subgroup to filter; click it again to show all groups. Downloads include the full roster, regardless of table filters.
      </p>
      <UTable
        :data="filteredRows"
        :columns="columns"
        :ui="{ td: 'whitespace-normal min-w-32 align-top' }"
        class="max-h-[65vh]"
        sticky
      >
        <template #fullName-cell="{ row }">
          <a
            :href="`https://dpscd.submittable.com/submissions/${encodeURIComponent(row.original.submissionId)}`"
            target="_blank"
            rel="noopener noreferrer"
            class="text-primary hover:underline"
          >
            {{ row.original.fullName || 'Name unavailable' }}
          </a>
        </template>
        <template #warnings-cell="{ row }">
          <ul class="space-y-1 text-sm">
            <li
              v-for="notice in row.original.notices"
              :key="notice"
              class="text-info"
            >
              {{ notice }}
            </li><li
              v-for="warning in row.original.warnings"
              :key="warning"
              class="text-warning"
            >
              {{ warning }}
            </li>
          </ul>
        </template>
      </UTable>
      <p class="text-xs text-muted">
        Generated {{ new Date(roster.generatedAt).toLocaleString() }}. Word cards are alphabetized, six per page, with names and notices only. Grouped rosters list students by subgroup with blank Proctor cells for staff to fill in. ZIPs include both Word formats and the Excel roster. Sensitive downloads are disclosure-audited.
      </p>
    </template>
  </UContainer>
</template>
