<script setup lang="ts">
import type { SelectItem, TableColumn } from '@nuxt/ui'

interface Cycle {
  _id: string
  year: string
  name: string
  active: boolean
}

interface EssayInfo {
  applicationId: string
  applicationName: string
  essayStageId: string
  essayStageName: string
}

interface ReviewerStat {
  reviewerId: string
  name: string
  completed: number
  perHour: number
  minScore: number | null
  maxScore: number | null
  avgScore: number | null
}

interface EssaySummary {
  completed: number
  avgScore: number | null
  activeReviewers: number
  avgPerReviewer: number
}

interface EssayStats {
  day: string
  daily: EssaySummary
  overallCompleted: number
  buckets: { time: string, count: number }[]
  reviewers: ReviewerStat[]
  overall?: EssaySummary
  overallReviewers?: ReviewerStat[]
  statusCounts?: { status: string, count: number }[]
}

interface EssayJob {
  _id: string
  type: string
  status: string
  progress?: { phase?: string, total?: number, processed?: number, percent?: number, message?: string }
  error?: string
  startedAt?: string
  completedAt?: string
  result?: {
    evaluated?: number
    moved?: number
    alreadyInStage?: number
    complete?: number
    inEssayStage?: number
    labelSync?: { added: number, removed: number }
    failures?: { submissionId: string, error: string }[]
    routing?: { evaluated?: number, moves?: number, noAction?: number, backwardMoves?: number }
    stats?: EssayStats
    export?: { name?: string }
  }
}

interface EssayState {
  essay: EssayInfo | null
  activeJob: EssayJob | null
  lastJob: EssayJob | null
}

const toast = useToast()
const { data: cycles } = await useFetch<Cycle[]>('/api/cycles')
const selectedCycleId = ref('')
const cycleItems = computed<SelectItem[]>(() =>
  (cycles.value || []).map(cycle => ({ label: `${cycle.year} — ${cycle.name}`, value: cycle._id }))
)

watchEffect(() => {
  const active = cycles.value?.find(cycle => cycle.active)
  if (active && !selectedCycleId.value) selectedCycleId.value = active._id
})

const { data: state, refresh: refreshState } = useFetch<EssayState>('/api/essays/state', {
  query: { cycleId: selectedCycleId },
  watch: false,
  immediate: false,
  default: () => ({ essay: null, activeJob: null, lastJob: null })
})

watch(selectedCycleId, (id) => {
  if (id) refreshState()
}, { immediate: true })

let pollTimer: ReturnType<typeof setTimeout> | null = null
const activeJob = computed(() => state.value?.activeJob || null)
const busy = computed(() => Boolean(activeJob.value) || starting.value)
const starting = ref(false)

function schedulePoll() {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = activeJob.value
    ? setTimeout(async () => {
        await refreshState()
        schedulePoll()
      }, 2000)
    : null
}

watch(activeJob, () => schedulePoll(), { immediate: true })
onUnmounted(() => {
  if (pollTimer) clearTimeout(pollTimer)
})

const lastJob = computed(() => state.value?.lastJob || null)
const stats = computed<EssayStats | null>(() => lastJob.value?.result?.stats || null)
const hasExport = computed(() => Boolean(lastJob.value?.result?.export?.name))
const exportUrl = computed(() => lastJob.value ? `/api/essays/export?jobId=${lastJob.value._id}` : '')

const jobButtons = [
  {
    type: 'essay_begin_scoring',
    label: 'Begin Scoring',
    icon: 'i-lucide-play',
    color: 'primary' as const,
    confirmText: 'This will refresh data from Submittable and move every submission whose essay review is required and incomplete into the essay stage, then sync essay status labels.'
  },
  {
    type: 'essay_update_scoring',
    label: 'Update Scoring',
    icon: 'i-lucide-refresh-cw',
    color: 'neutral' as const,
    confirmText: 'This will refresh data from Submittable and update essay status labels. No submissions will be moved.'
  },
  {
    type: 'essay_finish_scoring',
    label: 'Finish Scoring',
    icon: 'i-lucide-flag',
    color: 'neutral' as const,
    confirmText: 'This will refresh data from Submittable, update essay status labels, and move every submission currently in the essay stage to its lowest required incomplete stage.'
  }
]

const pendingJob = ref<typeof jobButtons[number] | null>(null)
const confirmOpen = ref(false)

function requestJob(type: string) {
  pendingJob.value = jobButtons.find(button => button.type === type) || null
  if (pendingJob.value) confirmOpen.value = true
}

async function confirmJob() {
  if (!pendingJob.value) return
  const type = pendingJob.value.type
  confirmOpen.value = false
  pendingJob.value = null
  await runJob(type)
}

async function runJob(type: string) {
  if (!selectedCycleId.value) return
  starting.value = true
  try {
    await $fetch('/api/jobs', {
      method: 'POST',
      body: { type, cycleId: selectedCycleId.value, payload: {} }
    })
    toast.add({ title: 'Job queued', color: 'success' })
    await refreshState()
  } catch (error: unknown) {
    const message = (error as { data?: { statusMessage?: string } }).data?.statusMessage || 'Failed to queue job'
    toast.add({ title: message, color: 'error' })
  } finally {
    starting.value = false
  }
}

function fmt(value: number | null | undefined, digits = 2) {
  return value == null ? '—' : value.toFixed(digits)
}

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString() : '—'
}

const reviewerColumns: TableColumn<ReviewerStat>[] = [
  { accessorKey: 'name', header: 'Reviewer' },
  { accessorKey: 'completed', header: 'Completed' },
  { accessorKey: 'perHour', header: 'Per hour' },
  { accessorKey: 'minScore', header: 'Min score' },
  { accessorKey: 'maxScore', header: 'Max score' },
  { accessorKey: 'avgScore', header: 'Avg score' }
]
</script>

<template>
  <UContainer class="py-8">
    <h1 class="text-2xl font-semibold mb-6">
      Essays
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

    <UAlert
      v-if="selectedCycleId && state && !state.essay"
      color="warning"
      variant="subtle"
      title="No essay review stage is configured for this cycle"
      class="mb-4"
    />

    <div
      v-if="state?.essay"
      class="mb-6 text-sm text-muted"
    >
      Essay stage: <span class="font-medium text-default">{{ state.essay.essayStageName }}</span>
      ({{ state.essay.applicationName }})
    </div>

    <div class="rounded-lg border p-4 mb-6">
      <div class="flex flex-wrap gap-2">
        <UButton
          v-for="button in jobButtons"
          :key="button.type"
          :label="button.label"
          :icon="button.icon"
          :color="button.color"
          :loading="starting || (activeJob?.type === button.type)"
          :disabled="busy || !selectedCycleId || !state?.essay"
          @click="requestJob(button.type)"
        />
        <UButton
          v-if="hasExport"
          label="Download Excel export"
          icon="i-lucide-download"
          color="neutral"
          variant="outline"
          :to="exportUrl"
          external
          download
        />
      </div>

      <div
        v-if="activeJob"
        class="mt-4 max-w-xl"
      >
        <UProgress
          :model-value="activeJob.progress?.percent ?? 0"
          :max="100"
          size="sm"
        />
        <p class="text-xs text-muted mt-1">
          {{ activeJob.progress?.message || 'Queued' }}
        </p>
      </div>

      <UAlert
        v-if="lastJob?.status === 'failed' && !activeJob"
        color="error"
        variant="subtle"
        :title="`Last job failed: ${lastJob.error || 'unknown error'}`"
        class="mt-4"
      />
    </div>

    <template v-if="stats">
      <div class="flex items-baseline justify-between mb-2">
        <h2 class="text-lg font-semibold">
          Daily summary — {{ stats.day }}
        </h2>
        <span
          v-if="lastJob"
          class="text-xs text-muted"
        >from {{ lastJob.type.replace(/^essay_|_scoring$/g, ' ') }} job completed {{ formatDate(lastJob.completedAt) }}</span>
      </div>

      <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <div class="rounded-lg border p-3">
          <p class="text-xs text-muted">
            Reviews today
          </p>
          <p class="text-2xl font-semibold">
            {{ stats.daily.completed }}
          </p>
        </div>
        <div class="rounded-lg border p-3">
          <p class="text-xs text-muted">
            Reviews overall
          </p>
          <p class="text-2xl font-semibold">
            {{ stats.overallCompleted }}
          </p>
        </div>
        <div class="rounded-lg border p-3">
          <p class="text-xs text-muted">
            Average score
          </p>
          <p class="text-2xl font-semibold">
            {{ fmt(stats.daily.avgScore) }}
          </p>
        </div>
        <div class="rounded-lg border p-3">
          <p class="text-xs text-muted">
            Active reviewers
          </p>
          <p class="text-2xl font-semibold">
            {{ stats.daily.activeReviewers }}
          </p>
        </div>
        <div class="rounded-lg border p-3">
          <p class="text-xs text-muted">
            Avg reviews / reviewer
          </p>
          <p class="text-2xl font-semibold">
            {{ fmt(stats.daily.avgPerReviewer) }}
          </p>
        </div>
      </div>

      <h2 class="text-lg font-semibold mb-2">
        Reviews per 15 minutes
      </h2>
      <div class="rounded-lg border p-4 mb-6">
        <UChart
          v-if="stats.buckets.length"
          :data="stats.buckets"
          index="time"
          :categories="[{ key: 'count', label: 'Reviews' }]"
          type="line"
          :points="true"
          x-label="Time (Detroit)"
          y-label="Reviews"
        />
        <p
          v-else
          class="text-sm text-muted"
        >
          No reviews have been completed today.
        </p>
      </div>

      <div
        v-if="stats.statusCounts?.length"
        class="mb-6"
      >
        <h2 class="text-lg font-semibold mb-2">
          Essay review status counts
        </h2>
        <div class="flex flex-wrap gap-2">
          <UBadge
            v-for="row in stats.statusCounts"
            :key="row.status"
            color="neutral"
            variant="subtle"
            size="lg"
          >
            {{ row.status }}: {{ row.count }}
          </UBadge>
        </div>
      </div>

      <h2 class="text-lg font-semibold mb-2">
        Reviewer stats — today
      </h2>
      <UTable
        :data="stats.reviewers"
        :columns="reviewerColumns"
        class="mb-6"
      />

      <template v-if="stats.overall">
        <h2 class="text-lg font-semibold mb-2">
          Overall summary — all days
        </h2>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div class="rounded-lg border p-3">
            <p class="text-xs text-muted">
              Reviews completed
            </p>
            <p class="text-2xl font-semibold">
              {{ stats.overall.completed }}
            </p>
          </div>
          <div class="rounded-lg border p-3">
            <p class="text-xs text-muted">
              Average score
            </p>
            <p class="text-2xl font-semibold">
              {{ fmt(stats.overall.avgScore) }}
            </p>
          </div>
          <div class="rounded-lg border p-3">
            <p class="text-xs text-muted">
              Reviewers
            </p>
            <p class="text-2xl font-semibold">
              {{ stats.overall.activeReviewers }}
            </p>
          </div>
          <div class="rounded-lg border p-3">
            <p class="text-xs text-muted">
              Avg reviews / reviewer
            </p>
            <p class="text-2xl font-semibold">
              {{ fmt(stats.overall.avgPerReviewer) }}
            </p>
          </div>
        </div>

        <h2 class="text-lg font-semibold mb-2">
          Reviewer stats — all days
        </h2>
        <UTable
          :data="stats.overallReviewers || []"
          :columns="reviewerColumns"
          class="mb-6"
        />
      </template>

      <div
        v-if="lastJob?.result?.routing"
        class="rounded-lg border p-4 mb-6 text-sm"
      >
        <h2 class="text-lg font-semibold mb-2">
          Finish routing
        </h2>
        <p class="text-muted">
          {{ lastJob.result.inEssayStage ?? 0 }} submissions were in the essay stage —
          {{ lastJob.result.routing.moves ?? 0 }} moved,
          {{ lastJob.result.routing.noAction ?? 0 }} unchanged<span v-if="lastJob.result.routing.backwardMoves">, {{ lastJob.result.routing.backwardMoves }} backward moves</span>.
        </p>
        <p
          v-if="lastJob.result.failures?.length"
          class="text-error mt-1"
        >
          {{ lastJob.result.failures.length }} failures — see job details on the Jobs page.
        </p>
      </div>
    </template>

    <p
      v-else-if="state && !activeJob"
      class="text-muted"
    >
      No scoring stats yet — run Update Scoring or Finish Scoring to generate them.
    </p>

    <UModal
      v-model:open="confirmOpen"
      :title="pendingJob ? `Run ${pendingJob.label}?` : 'Run job?'"
    >
      <template #body>
        <p class="text-sm">
          {{ pendingJob?.confirmText }}
        </p>
      </template>

      <template #footer="{ close }">
        <UButton
          color="neutral"
          variant="outline"
          label="Cancel"
          @click="close"
        />
        <UButton
          :label="pendingJob?.label"
          :icon="pendingJob?.icon"
          :loading="starting"
          @click="confirmJob"
        />
      </template>
    </UModal>
  </UContainer>
</template>
