<script setup lang="ts">
import type { SelectItem, TableColumn } from '@nuxt/ui'

interface Cycle {
  _id: string
  year: string
  name: string
  active: boolean
}

interface Application {
  _id: string
  name: string
  projectId: string
}

interface JobProgress {
  phase?: string
  total?: number
  processed?: number
  percent?: number
  message?: string
}

interface FormResult {
  formId: string
  formName: string
  childJobId: string
  status: string
  entries: number
  error?: string
}

interface Job {
  _id: string
  type: string
  status: 'pending' | 'waiting' | 'running' | 'completed' | 'failed'
  cycleId: string
  createdBy: string
  result?: { forms?: FormResult[], [key: string]: unknown }
  error?: string
  progress?: JobProgress
  startedAt?: string
  completedAt?: string
  createdAt: string
}

const toast = useToast()
const { data: cycles } = await useFetch<Cycle[]>('/api/cycles')
const selectedCycleId = ref('')
const selectedApplicationId = ref('')
const refreshDryRun = ref(false)
const refreshBatchSize = ref(250)
const cycleItems = computed<SelectItem[]>(() =>
  (cycles.value || []).map(cycle => ({ label: `${cycle.year} — ${cycle.name}`, value: cycle._id }))
)

watchEffect(() => {
  const active = cycles.value?.find(cycle => cycle.active)
  if (active && !selectedCycleId.value) selectedCycleId.value = active._id
})

const applicationsUrl = computed(() => selectedCycleId.value ? `/api/applications?cycleId=${selectedCycleId.value}` : '/api/applications?cycleId=none')
const { data: applications } = useFetch<Application[]>(applicationsUrl)
const applicationItems = computed<SelectItem[]>(() => [
  { label: 'Entire cycle', value: '' },
  ...(applications.value || []).map(application => ({ label: application.name, value: application._id }))
])

watch(selectedCycleId, () => {
  selectedApplicationId.value = ''
})

const jobsUrl = computed(() => `/api/jobs?cycleId=${selectedCycleId.value}`)
const { data: jobs, status: jobsStatus } = useFetch<Job[]>(jobsUrl)
let pollTimer: ReturnType<typeof setTimeout> | null = null
let pollInFlight = false

function hasActiveJobs() {
  return (jobs.value || []).some(job => ['pending', 'waiting', 'running'].includes(job.status))
}

function schedulePoll(delay = 2000) {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = hasActiveJobs() ? setTimeout(pollProgress, delay) : null
}

async function pollProgress() {
  if (!selectedCycleId.value || !hasActiveJobs() || pollInFlight) return
  pollInFlight = true
  try {
    const updates = await $fetch<Partial<Job>[]>('/api/jobs/progress', {
      query: { cycleId: selectedCycleId.value, timestamp: Date.now() }
    })
    const jobsById = new Map((jobs.value || []).map(job => [job._id, job]))
    for (const update of updates) {
      const job = update._id ? jobsById.get(update._id) : undefined
      if (job) Object.assign(job, update)
    }
    jobs.value = [...(jobs.value || [])]
  } finally {
    pollInFlight = false
    schedulePoll()
  }
}

watch(() => (jobs.value || []).map(job => `${job._id}:${job.status}`).join(','), () => {
  schedulePoll(0)
}, { immediate: true })

onUnmounted(() => {
  if (pollTimer) clearTimeout(pollTimer)
})

const starting = ref(false)
const jobOptions = [
  { value: 'metadata_sync', label: 'Metadata sync' },
  { value: 'submission_extraction', label: 'Submission extraction' },
  { value: 'form_response_mapping', label: 'Form response mapping' },
  { value: 'run_validation', label: 'Run validation' },
  { value: 'catchment_lookup', label: 'Catchment lookup' },
  { value: 'score_compilation', label: 'Score compilation' }
]

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString() : '—'
}

function statusColor(status: string) {
  if (status === 'completed') return 'success'
  if (status === 'failed') return 'error'
  if (status === 'running' || status === 'waiting') return 'warning'
  return 'neutral'
}

function formatResult(job: Job) {
  if (job.error) return job.error.slice(0, 120)
  if (['pending', 'waiting', 'running'].includes(job.status)) return job.progress?.message || 'Queued'
  if (!job.result) return '—'
  if (job.type === 'submission_extraction') {
    return `${job.result.forms?.length || 0} forms, ${job.result.entries || 0} entries`
  }
  if (job.type === 'metadata_sync') {
    const { projects = 0, forms = 0, labels = 0, team = 0 } = job.result
    return `projects ${projects}, forms ${forms}, labels ${labels}, team ${team}`
  }
  if (job.type === 'catchment_lookup') {
    const { total = 0, primary = 0, secondary = 0, failed = 0, noAddress = 0 } = job.result
    return `${total} checked — ${primary} primary, ${secondary} secondary, ${failed} failed, ${noAddress} no address`
  }
  if (job.type === 'dpscd_gpa_import') {
    const { processed = 0, matched = 0, updated = 0, unmatched = 0 } = job.result
    return `${processed} processed — ${matched} matched, ${updated} updated, ${unmatched} unmatched`
  }
  if (job.type === 'optin_gpa_preview') {
    const { processed = 0, matched = 0, missingOptInLabel = 0, unmatched = 0 } = job.result
    return `${processed} rows — ${matched} matched, ${missingOptInLabel} missing label, ${unmatched} unmatched`
  }
  if (job.type === 'optin_gpa_commit') {
    const { processed = 0, updated = 0, inserted = 0, skippedUnmatched = 0 } = job.result
    return `${processed} rows — ${Number(updated) + Number(inserted)} written, ${skippedUnmatched} unmatched skipped`
  }
  if (job.type === 'refresh_review_completion') {
    const { processed = 0, updated = 0, diagnostics = 0, dryRun = false } = job.result
    return `${processed} processed — ${dryRun ? 'dry run' : `${updated} updated`}, ${diagnostics} diagnostics`
  }
  return JSON.stringify(job.result).slice(0, 100)
}

async function runJob(type: string, payload: Record<string, unknown> = {}) {
  if (!selectedCycleId.value) return
  starting.value = true
  try {
    const job = await $fetch<Job>('/api/jobs', {
      method: 'POST',
      body: { type, cycleId: selectedCycleId.value, payload }
    })
    jobs.value = [job, ...(jobs.value || [])]
    toast.add({ title: 'Job queued', color: 'success' })
  } catch (error: unknown) {
    const message = (error as { data?: { statusMessage?: string } }).data?.statusMessage || 'Failed to queue job'
    toast.add({ title: message, color: 'error' })
  } finally {
    starting.value = false
  }
}

const columns: TableColumn<Job>[] = [
  { accessorKey: 'type', header: 'Type' },
  { accessorKey: 'status', header: 'Status' },
  { id: 'progress', header: 'Progress', enableSorting: false },
  { id: 'result', header: 'Result', enableSorting: false },
  { id: 'timing', accessorKey: 'startedAt', header: 'Started' },
  { id: 'actions', header: 'Actions', enableSorting: false }
]

const selectedJob = ref<Job | null>(null)
const modalOpen = ref(false)

function openDetails(job: Job) {
  selectedJob.value = job
  modalOpen.value = true
}
</script>

<template>
  <UContainer class="py-8">
    <h1 class="text-2xl font-semibold mb-6">
      Jobs
    </h1>

    <UFormField
      label="Admission cycle"
      class="mb-4"
    >
      <USelect
        v-model="selectedCycleId"
        :items="cycleItems"
        placeholder="Select a cycle"
        class="w-72"
      />
    </UFormField>

    <div class="mb-6 rounded-lg border p-4 space-y-3">
      <div class="flex flex-wrap items-end gap-3">
        <UFormField label="Refresh scope">
          <USelect
            v-model="selectedApplicationId"
            :items="applicationItems"
            class="w-72"
          />
        </UFormField>
        <UFormField label="Batch size">
          <UInput
            v-model.number="refreshBatchSize"
            type="number"
            min="1"
            max="1000"
            class="w-28"
          />
        </UFormField>
        <UCheckbox
          v-model="refreshDryRun"
          label="Dry run (do not write ledgers)"
        />
        <UButton
          label="Refresh review completion"
          :loading="starting"
          :disabled="!selectedCycleId"
          @click="runJob('refresh_review_completion', {
            applicationId: selectedApplicationId || undefined,
            batchSize: refreshBatchSize,
            dryRun: refreshDryRun
          })"
        />
      </div>
      <p class="text-sm text-muted">
        Recomputes each submission's reviewCompletion ledger from current mapped fields, reviews, GPA records, HSPT links, and routing configuration.
      </p>
    </div>

    <div class="flex flex-wrap gap-2 mb-6">
      <UButton
        v-for="option in jobOptions"
        :key="option.value"
        :label="option.label"
        :loading="starting"
        :disabled="!selectedCycleId"
        @click="runJob(option.value)"
      />
    </div>

    <div
      v-if="jobsStatus === 'pending' && !jobs?.length"
      class="text-muted"
    >
      Loading jobs...
    </div>

    <UTable
      v-else
      :data="jobs || []"
      :columns="columns"
      :get-row-id="(row: Job) => row._id"
    >
      <template #status-cell="{ row }">
        <UBadge
          :label="row.original.status"
          :color="statusColor(row.original.status)"
          variant="subtle"
        />
      </template>

      <template #progress-cell="{ row }">
        <div
          v-if="row.original.progress"
          class="w-56"
        >
          <UProgress
            :model-value="row.original.progress.percent ?? 0"
            :max="100"
            :color="row.original.status === 'completed' ? 'success' : 'primary'"
            size="sm"
          />
          <p class="text-xs text-muted mt-1 truncate">
            {{ row.original.progress.message || '' }}
          </p>
        </div>
        <span
          v-else
          class="text-sm text-muted"
        >—</span>
      </template>

      <template #result-cell="{ row }">
        <span class="text-sm text-muted">{{ formatResult(row.original) }}</span>
      </template>

      <template #timing-cell="{ row }">
        <span class="text-sm text-muted">{{ formatDate(row.original.startedAt) }}</span>
      </template>

      <template #actions-cell="{ row }">
        <UButton
          icon="i-lucide-eye"
          color="neutral"
          variant="ghost"
          aria-label="View details"
          @click="openDetails(row.original)"
        />
      </template>
    </UTable>

    <UModal
      v-model:open="modalOpen"
      title="Job details"
      :ui="{ content: '!max-w-4xl' }"
    >
      <template #body>
        <div
          v-if="selectedJob?.result?.forms?.length"
          class="mb-6 overflow-auto max-h-96 border rounded-lg"
        >
          <table class="w-full text-sm">
            <thead class="bg-muted text-left sticky top-0">
              <tr>
                <th class="p-2">
                  Form
                </th>
                <th class="p-2">
                  Form ID
                </th>
                <th class="p-2">
                  Status
                </th>
                <th class="p-2 text-right">
                  Entries
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="form in selectedJob.result.forms"
                :key="form.childJobId"
                class="border-t"
              >
                <td class="p-2">
                  {{ form.formName }}
                </td>
                <td class="p-2 font-mono text-xs">
                  {{ form.formId }}
                </td>
                <td class="p-2">
                  <UBadge
                    :label="form.status"
                    :color="statusColor(form.status)"
                    variant="subtle"
                  />
                  <p
                    v-if="form.error"
                    class="text-xs text-error mt-1"
                  >
                    {{ form.error }}
                  </p>
                </td>
                <td class="p-2 text-right">
                  {{ form.entries }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <pre
          v-if="selectedJob"
          class="text-xs bg-muted p-4 rounded overflow-auto max-h-72"
        >{{ JSON.stringify(selectedJob, null, 2) }}</pre>
      </template>

      <template #footer="{ close }">
        <UButton
          color="neutral"
          variant="outline"
          label="Close"
          @click="close"
        />
      </template>
    </UModal>
  </UContainer>
</template>
