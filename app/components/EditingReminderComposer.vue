<script setup lang="ts">
interface Preview { submissionId: string, subject: string, bodyHtml: string }
interface Outcome { submissionId: string, status: string, error?: string }
const props = defineProps<{ cycleId: string, submissionIds: string[] }>()
const emit = defineEmits<{ finished: [] }>()
const open = defineModel<boolean>('open', { default: false })
const { data: templates } = await useFetch<Array<{ _id: string, name: string }>>('/api/templates', { default: () => [] })
const templateId = ref('')
const previews = ref<Preview[]>([])
const digest = ref('')
const requestKey = ref('')
const busy = ref(false)
const error = ref('')
const confirmed = ref(false)
const jobId = ref('')
const jobStatus = ref('')
const outcomes = ref<Outcome[]>([])
const progress = ref('')
let timer: ReturnType<typeof setTimeout> | undefined
let generation = 0
watch([open, templateId], () => {
  if (timer) clearTimeout(timer)
  generation++
  previews.value = []
  digest.value = ''
  requestKey.value = ''
  confirmed.value = false
  error.value = ''
  jobId.value = ''
  jobStatus.value = ''
  outcomes.value = []
  progress.value = ''
})
onBeforeUnmount(() => {
  generation++
  if (timer) clearTimeout(timer)
})

async function preview() {
  busy.value = true
  error.value = ''
  const version = generation
  try {
    const result = await $fetch<{ previews: Preview[], digest: string }>('/api/submissions/editing/preview', { method: 'POST', body: { cycleId: props.cycleId, submissionIds: props.submissionIds, templateId: templateId.value } })
    if (version !== generation) return
    previews.value = result.previews
    digest.value = result.digest
    requestKey.value = crypto.randomUUID()
    confirmed.value = false
  } catch {
    if (version === generation) error.value = 'Preview failed. Refresh extraction and check that the template has no unresolved fields and all selected applications are still open.'
  } finally { busy.value = false }
}

async function poll(version: number) {
  if (version !== generation || !jobId.value || !open.value) return
  try {
    const job = await $fetch<{ status: string, progress?: { message?: string }, result?: { outcomes?: Outcome[] } }>(`/api/jobs/${jobId.value}`)
    if (version !== generation) return
    jobStatus.value = job.status
    progress.value = job.progress?.message || job.status
    outcomes.value = job.result?.outcomes || []
    if (['completed', 'failed'].includes(job.status)) {
      emit('finished')
      return
    }
  } catch {
    error.value = 'Unable to read job progress. The job may still send reminders. Do not submit again; check the Jobs page.'
  }
  if (version === generation) timer = setTimeout(() => poll(version), 2500)
}

async function send() {
  if (!confirmed.value || !digest.value || busy.value || jobId.value) return
  busy.value = true
  error.value = ''
  const version = generation
  try {
    const result = await $fetch<{ jobId: string }>('/api/submissions/editing/reminders', { method: 'POST', body: { cycleId: props.cycleId, submissionIds: props.submissionIds, templateId: templateId.value, digest: digest.value, requestKey: requestKey.value, confirmed: true } })
    if (version !== generation) return
    jobId.value = result.jobId
    jobStatus.value = 'pending'
    await poll(version)
  } catch {
    if (version === generation) error.value = 'Queueing was not confirmed. Retry with this same preview to safely recover the request, or check Jobs before starting another reminder.'
  } finally { busy.value = false }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="Send editing reminders"
    description="Preview and confirm a message to the Submittable submitter for each selected submission."
    :dismissible="!busy && !jobId"
    :ui="{ content: '!max-w-3xl' }"
  >
    <template #body>
      <div class="space-y-4">
        <UAlert
          color="warning"
          title="Recipient and scope"
          :description="`Messages go to each submission's Submittable submitter, not necessarily the mapped student or parent email. ${submissionIds.length} initial application(s) selected. No editing permissions or routing will be changed.`"
        />
        <UAlert
          v-if="error"
          color="error"
          :description="error"
        />
        <template v-if="!jobId">
          <UFormField label="Message template">
            <USelect
              v-model="templateId"
              :items="templates.map(t => ({ label: t.name, value: t._id }))"
              :disabled="busy"
              placeholder="Select a template"
              class="w-full"
            />
          </UFormField>
          <UButton
            label="Preview all selected reminders"
            :disabled="!templateId"
            :loading="busy"
            @click="preview"
          />
          <div
            v-for="item in previews"
            :key="item.submissionId"
            class="border rounded-lg p-3 space-y-2"
          >
            <p class="text-xs text-muted break-all">
              Submission {{ item.submissionId }}
            </p>
            <p class="font-semibold">
              {{ item.subject }}
            </p>
            <iframe
              :srcdoc="item.bodyHtml"
              sandbox=""
              referrerpolicy="no-referrer"
              title="Reminder preview"
              class="w-full h-48 bg-white border rounded"
            />
          </div>
          <UCheckbox
            v-if="previews.length"
            v-model="confirmed"
            :disabled="busy"
            :label="`I confirm sending these ${previews.length} reminder(s). Applicants will receive a real message.`"
          />
          <UButton
            v-if="previews.length"
            label="Confirm and send reminders"
            :disabled="!confirmed"
            :loading="busy"
            @click="send"
          />
        </template>
        <template v-else>
          <p>{{ progress || 'Queued' }}</p>
          <UButton
            to="/jobs"
            label="View Jobs"
            color="neutral"
            variant="outline"
          />
          <div
            v-for="outcome in outcomes"
            :key="outcome.submissionId"
            class="border rounded p-2 text-sm"
          >
            <p class="break-all">
              {{ outcome.submissionId }} — {{ outcome.status }}
            </p>
            <p
              v-if="outcome.error"
              class="text-warning"
            >
              {{ outcome.error }}
            </p>
          </div>
          <p class="text-sm text-muted">
            Sent means accepted by the messaging API, not confirmed delivered or read. Uncertain or audit-failed results require operator review; do not resend automatically.
          </p>
        </template>
      </div>
    </template>
    <template #footer="{ close }">
      <UButton
        label="Close"
        color="neutral"
        variant="outline"
        :disabled="busy"
        @click="close"
      />
    </template>
  </UModal>
</template>
