<script setup lang="ts">
import { scheduledJobs, prerequisites, orderError, selectScheduledJob, type ScheduleInput, type ScheduledJobType } from '~~/shared/jobSchedule'

interface Schedule extends ScheduleInput { _id: string, nextAt?: string }
interface Run { _id: string, scheduleId: string, name: string, status: string, dueAt: string, stepIndex: number, steps: ScheduledJobType[], message?: string }
interface Hold { cycleId: string, hold: string }
interface RunJob { _id: string, type: string, status: string, error?: string, progress?: { message?: string }, result?: unknown }
const toast = useToast()
const { data, refresh, error: loadError, status: loadStatus } = await useFetch<{ schedules: Schedule[], holds: Hold[] }>('/api/job-schedules')
const page = ref(1)
const historyChain = ref('all')
const historyQuery = computed(() => ({ page: page.value, ...(historyChain.value !== 'all' ? { scheduleId: historyChain.value } : {}) }))
const historyOptions = computed(() => [{ label: 'All chains', value: 'all' }, ...(data.value?.schedules || []).map(schedule => ({ label: schedule.name, value: schedule._id }))])
watch(historyChain, () => {
  page.value = 1
})
const { data: history, refresh: refreshHistory, error: historyError } = await useFetch<{ runs: Run[], total: number, queued: Run[] }>('/api/job-schedules/runs', { query: historyQuery })
const editingId = ref('')
const editorOpen = ref(false)
const saving = ref(false)
const error = ref('')
const defaults = (): ScheduleInput => ({ name: '', time: '02:00', enabled: false, steps: ['metadata_sync', 'submission_extraction', 'form_response_mapping', 'catchment_lookup', 'run_validation', 'refresh_review_completion'], dryRun: true, acknowledged: false, revision: 0 })
const form = ref<ScheduleInput>(defaults())
const detail = ref<{ run: Run, jobs: RunJob[] } | null>(null)
const detailOpen = ref(false)
const holdAcknowledged = ref(false)
const label = (type: string) => scheduledJobs.find(job => job.type === type)?.label || type
const date = (value: string) => new Date(value).toLocaleString('en-US', { timeZone: 'America/Detroit', timeZoneName: 'short' })
const dependency = (type: ScheduledJobType) => form.value.steps.find(step => prerequisites[step] === type)
function edit(schedule?: Schedule) {
  editingId.value = schedule?._id || ''
  form.value = schedule ? { name: schedule.name, time: schedule.time, enabled: schedule.enabled, steps: [...schedule.steps], dryRun: schedule.dryRun, acknowledged: false, revision: schedule.revision } : defaults()
  error.value = ''
  editorOpen.value = true
}
function toggle(type: ScheduledJobType, selected: boolean) {
  form.value.steps = selected ? selectScheduledJob(form.value.steps, type) : form.value.steps.filter(step => step !== type)
  form.value.acknowledged = false
}
function moved(index: number, direction: number) {
  const steps = [...form.value.steps]
  const other = index + direction
  if (other < 0 || other >= steps.length) return steps
  ;[steps[index], steps[other]] = [steps[other]!, steps[index]!]
  return steps
}
function move(index: number, direction: number) {
  const steps = moved(index, direction)
  if (!orderError(steps)) form.value.steps = steps
}
function message(cause: unknown) {
  return (cause as { data?: { statusMessage?: string } }).data?.statusMessage || 'Request failed'
}
async function save() {
  saving.value = true
  error.value = ''
  try {
    if (editingId.value) await $fetch(`/api/job-schedules/${editingId.value}`, { method: 'PUT', body: form.value })
    else await $fetch('/api/job-schedules', { method: 'POST', body: form.value })
    editorOpen.value = false
    await refresh()
    toast.add({ title: 'Scheduled chain saved', color: 'success' })
  } catch (cause) {
    error.value = message(cause)
  } finally {
    saving.value = false
  }
}
async function showRun(id: string) {
  try {
    detail.value = await $fetch(`/api/job-schedules/runs/${id}`)
    detailOpen.value = true
  } catch (cause) { toast.add({ title: message(cause), color: 'error' }) }
}
async function release(hold: Hold) {
  try {
    await $fetch('/api/job-schedules/release-hold', { method: 'POST', body: { cycleId: hold.cycleId, hold: hold.hold, acknowledged: true } })
    holdAcknowledged.value = false
    await refresh()
  } catch (cause) { toast.add({ title: message(cause), color: 'error' }) }
}
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => {
    void refreshHistory()
    void refresh()
    if (detailOpen.value && detail.value) void showRun(detail.value.run._id)
  }, 10000)
})
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <UContainer class="py-8 space-y-6">
    <UAlert
      v-if="loadError || historyError"
      color="error"
      title="Unable to load scheduler data"
      description="Check your connection and refresh the page. Unsaved edits have not been submitted."
    />
    <p
      v-if="loadStatus === 'pending'"
      class="text-muted"
    >
      Loading scheduled chains...
    </p>
    <div class="flex flex-wrap items-center justify-between gap-3">
      <PageHeader
        title="Job Scheduler"
        help="scheduler"
      />
      <div class="flex gap-2">
        <UButton
          to="/jobs"
          label="Manual jobs"
          color="neutral"
          variant="outline"
        />
        <UButton
          label="New chain"
          icon="i-lucide-plus"
          @click="edit()"
        />
      </div>
    </div>
    <p class="text-sm text-muted">
      Each chain runs daily in America/Detroit, against the uniquely active cycle at its scheduled time. Due chains queue in order and run sequentially for each cycle. Manual jobs can still overlap.
      Pausing or editing affects future occurrences, not queued or running snapshots. Trigger precision is approximately one minute; missed prior days are not replayed.
    </p>
    <div
      v-for="hold in data?.holds"
      :key="hold.cycleId"
      class="rounded-lg border border-error p-4 space-y-3"
    >
      <p class="font-semibold">
        Scheduled work is held for review
      </p>
      <p>{{ hold.hold }} (cycle {{ hold.cycleId }})</p>
      <UCheckbox
        v-model="holdAcknowledged"
        label="I have reviewed the external actions and approve starting queued chains."
      />
      <UButton
        label="Release hold"
        color="warning"
        :disabled="!holdAcknowledged"
        @click="release(hold)"
      />
    </div>
    <p
      v-if="!data?.schedules.length"
      class="text-muted"
    >
      No scheduled chains. Create a chain to select jobs and a daily time.
    </p>
    <div
      v-for="schedule in data?.schedules"
      :key="schedule._id"
      class="rounded-lg border p-4 space-y-3"
    >
      <div class="flex justify-between gap-3">
        <div>
          <h2 class="font-semibold">
            {{ schedule.name }}
          </h2>
          <p class="text-sm text-muted">
            {{ schedule.time }} America/Detroit · {{ schedule.enabled ? 'Enabled' : 'Paused' }}
          </p>
          <p
            v-if="schedule.nextAt"
            class="text-sm"
          >
            Next: {{ date(schedule.nextAt) }}
          </p>
        </div>
        <UButton
          label="Edit chain"
          color="neutral"
          variant="outline"
          @click="edit(schedule)"
        />
      </div>
      <ol class="list-decimal pl-6 text-sm">
        <li
          v-for="step in schedule.steps"
          :key="step"
        >
          {{ label(step) }}{{ (step === 'run_routing' || step === 'registration_sync') && schedule.dryRun ? ' (dry run)' : '' }}
        </li>
      </ol>
    </div>
    <section class="space-y-3">
      <h2 class="text-lg font-semibold">
        Active and queued chains
      </h2>
      <p
        v-if="!history?.queued.length"
        class="text-muted"
      >
        No waiting work.
      </p>
      <div
        v-for="(run, index) in history?.queued"
        :key="run._id"
        class="flex flex-wrap items-center justify-between gap-2 rounded border p-3"
      >
        <div>
          <p>{{ index + 1 }}. {{ run.name }} — {{ run.status }}</p><p class="text-sm text-muted">
            Due {{ date(run.dueAt) }} · {{ label(run.steps[run.stepIndex] || '') }} · {{ run.message }}
          </p><p
            v-if="Date.now() - new Date(run.dueAt).getTime() > 86400000"
            class="text-warning"
          >
            Backlog: waiting more than a day
          </p>
        </div>
        <UButton
          label="Details"
          variant="ghost"
          @click="showRun(run._id)"
        />
      </div>
    </section>
    <section class="space-y-3">
      <h2 class="text-lg font-semibold">
        Run history
      </h2>
      <USelect
        v-model="historyChain"
        :items="historyOptions"
        aria-label="Filter run history by chain"
        class="w-72"
      />
      <div
        v-for="run in history?.runs"
        :key="run._id"
        class="flex flex-wrap justify-between gap-2 border-b py-3"
      >
        <div>
          <p>{{ run.name }} — {{ run.status }}</p><p class="text-sm text-muted">
            {{ date(run.dueAt) }} · {{ run.message }}
          </p>
        </div>
        <UButton
          label="Details"
          variant="ghost"
          @click="showRun(run._id)"
        />
      </div>
      <UPagination
        v-model:page="page"
        :total="history?.total || 0"
        :items-per-page="25"
      />
    </section>
    <UModal
      v-model:open="editorOpen"
      :title="editingId ? 'Edit scheduled chain' : 'New scheduled chain'"
      :ui="{ content: 'max-w-3xl' }"
    >
      <template #body>
        <div class="space-y-4">
          <UFormField label="Chain name">
            <UInput
              v-model="form.name"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Daily time — America/Detroit">
            <UInput
              v-model="form.time"
              type="time"
            />
          </UFormField>
          <p class="text-xs text-muted">
            DST: missing times run at the next valid minute; repeated times run once. Enabling or changing time schedules the next future occurrence.
          </p>
          <UCheckbox
            v-model="form.enabled"
            label="Enable daily schedule"
          />
          <h3 class="font-semibold">
            Select jobs
          </h3>
          <div
            v-for="job in scheduledJobs"
            :key="job.type"
          >
            <UCheckbox
              :model-value="form.steps.includes(job.type)"
              :label="job.label"
              :disabled="!!dependency(job.type)"
              @update:model-value="toggle(job.type, !!$event)"
            />
            <p
              v-if="dependency(job.type)"
              class="text-xs text-muted ml-6"
            >
              Required by {{ label(dependency(job.type)!) }}. Deselect that job first.
            </p>
          </div>
          <p class="text-sm text-muted">
            Mapping adds extraction; routing adds review-completion refresh. Upload jobs and unimplemented score compilation are unavailable. Essay jobs refresh their own data and can change external labels or stages.
          </p>
          <h3 class="font-semibold">
            Execution order
          </h3>
          <div
            v-for="(step, index) in form.steps"
            :key="step"
            class="flex items-center justify-between gap-2"
          >
            <span>{{ index + 1 }}. {{ label(step) }}</span>
            <div class="flex gap-1">
              <UButton
                icon="i-lucide-arrow-up"
                :aria-label="`Move ${label(step)} up`"
                color="neutral"
                variant="ghost"
                :disabled="index === 0 || !!orderError(moved(index, -1))"
                @click="move(index, -1)"
              />
              <UButton
                icon="i-lucide-arrow-down"
                :aria-label="`Move ${label(step)} down`"
                color="neutral"
                variant="ghost"
                :disabled="index === form.steps.length - 1 || !!orderError(moved(index, 1))"
                @click="move(index, 1)"
              />
            </div>
          </div>
          <p class="text-xs text-muted">
            Required order: extraction before mapping, catchment before validation when selected, refresh before routing, validation before registration sync.
          </p>
          <UCheckbox
            v-if="form.steps.includes('run_routing') || form.steps.includes('registration_sync')"
            v-model="form.dryRun"
            label="Dry run (full cycle; no external routing or registration writes)"
          />
          <p class="text-sm text-warning">
            Live routing and essay workflows can modify Submittable submissions or send configured messages. Omitted data jobs mean later steps use existing stored data.
          </p>
          <UCheckbox
            v-model="form.acknowledged"
            label="I acknowledge the selected jobs' external effects and approve this schedule."
          />
          <p
            v-if="error || orderError(form.steps)"
            role="alert"
            class="text-error"
          >
            {{ error || orderError(form.steps) }}
          </p>
        </div>
      </template>
      <template #footer>
        <UButton
          label="Save chain"
          :loading="saving"
          :disabled="!!orderError(form.steps)"
          @click="save"
        /><UButton
          label="Cancel"
          color="neutral"
          variant="ghost"
          @click="editorOpen = false"
        />
      </template>
    </UModal>
    <UModal
      v-model:open="detailOpen"
      title="Scheduled run details"
      :ui="{ content: 'max-w-4xl' }"
    >
      <template #body>
        <div
          v-if="detail"
          class="space-y-4"
        >
          <p>{{ detail.run.name }} — {{ detail.run.status }} · {{ detail.run.message }}</p>
          <ol class="list-decimal pl-6">
            <li
              v-for="step in detail.run.steps"
              :key="step"
            >
              {{ label(step) }}
            </li>
          </ol>
          <div
            v-for="job in detail.jobs"
            :key="job._id"
            class="border-t pt-3 space-y-2"
          >
            <p>{{ label(job.type) }} — {{ job.status }} · {{ job.progress?.message || job.error }}</p>
            <UButton
              :to="`/jobs?jobId=${job._id}`"
              label="View job"
              variant="ghost"
            />
            <pre class="text-xs bg-muted p-3 rounded overflow-auto max-h-56">{{ JSON.stringify(job.result, null, 2) }}</pre>
          </div>
        </div>
      </template>
    </UModal>
  </UContainer>
</template>
