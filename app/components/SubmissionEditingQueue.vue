<script setup lang="ts">
interface EditingRow {
  submissionId: string
  submissionIdInt?: number
  applicationName: string
  currentStageName?: string
  status: string
  mappedFields: { FullName?: string, FirstName?: string, LastName?: string, Email?: string, ParentEmail?: string }
  editing: { openedForEditingAt?: string, editingCheckedAt: string }
  reminder?: { reminderCount: number, lastReminderAt?: string, needsReview: number }
}
const props = defineProps<{ cycleId: string, applicationId: string, stageId: string, labelId: string, search: string }>()
const page = ref(1)
const minDays = ref('0')
const selected = ref<string[]>([])
const composerOpen = ref(false)
const recipients = ref<string[]>([])
const detail = ref<EditingRow>()
const detailOpen = ref(false)
const requestFetch = useRequestFetch()
const query = computed(() => ({ cycleId: props.cycleId, applicationId: props.applicationId === '__all__' ? undefined : props.applicationId, stageId: props.stageId === '__all__' ? undefined : props.stageId, labelId: props.labelId === '__all__' ? undefined : props.labelId, q: props.search, minDays: minDays.value, page: page.value }))
const { data, status, error, refresh } = await useAsyncData('editing-queue', () => props.cycleId ? requestFetch<{ submissions: EditingRow[], total: number, page: number, limit: number }>('/api/submissions/editing', { query: query.value }) : Promise.resolve({ submissions: [], total: 0, page: 1, limit: 25 }), { watch: [query] })
watch([() => props.cycleId, () => props.applicationId, () => props.stageId, () => props.labelId, () => props.search, minDays], () => {
  page.value = 1
  selected.value = []
  detailOpen.value = false
  composerOpen.value = false
})
watch(page, () => {
  selected.value = []
})
function toggle(id: string, checked: boolean) {
  selected.value = checked ? [...new Set([...selected.value, id])] : selected.value.filter(value => value !== id)
}
function remind(ids: string[]) {
  recipients.value = [...ids]
  composerOpen.value = true
}
function date(value?: string) {
  return value ? new Date(value).toLocaleString() : 'Unknown'
}
function days(value?: string) {
  return value ? `${Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86400000))} days` : 'Unknown'
}
const columns = [
  { id: 'select', header: 'Select' }, { id: 'applicant', header: 'Applicant' },
  { accessorKey: 'applicationName', header: 'Application' }, { accessorKey: 'currentStageName', header: 'Stage' },
  { id: 'opened', header: 'Opened for editing' }, { id: 'age', header: 'Days open' },
  { id: 'checked', header: 'Source checked' }, { id: 'reminder', header: 'Reminders' }, { id: 'actions', header: 'Actions' }
]
</script>

<template>
  <div class="space-y-4">
    <UAlert
      color="info"
      title="Awaiting applicant edits"
      description="Only initial applications confirmed editable at the latest extraction appear here. Closing editing removes them from this queue; it does not verify that requested documents are complete. Opening time is not email delivery time. Unknown or ambiguous entries are excluded."
    />
    <p class="text-sm text-muted">
      This is synced data, not a live view. Run <NuxtLink
        to="/jobs"
        class="underline"
      >submission extraction, then form response mapping, in Jobs</NuxtLink> to update editing status and restore prepared applicant fields. Reminder counts cover this feature only.
    </p>
    <div class="flex flex-wrap gap-3 items-end">
      <UFormField label="Time open">
        <USelect
          v-model="minDays"
          :items="[{ label: 'All ages', value: '0' }, { label: '7+ days', value: '7' }, { label: '14+ days', value: '14' }]"
        />
      </UFormField>
      <UButton
        label="Refresh synced list"
        color="neutral"
        variant="outline"
        :loading="status === 'pending'"
        @click="refresh()"
      />
      <UButton
        :label="`Remind selected (${selected.length})`"
        :disabled="!selected.length || status === 'pending'"
        @click="remind(selected)"
      />
      <span class="text-sm text-muted">{{ data?.total || 0 }} open applications · oldest known opening first</span>
    </div>
    <UAlert
      v-if="error"
      color="error"
      title="Unable to load editing queue"
      description="Please retry. No editing status has been changed."
    />
    <UTable
      :data="data?.submissions || []"
      :columns="columns"
      :loading="status === 'pending'"
      empty="No confirmed open initial applications match. If editing metadata has not been synced, run submission extraction first."
      class="border rounded-lg"
    >
      <template #select-cell="{ row }">
        <UCheckbox
          :model-value="selected.includes(row.original.submissionId)"
          :aria-label="`Select ${row.original.submissionId}`"
          :disabled="status === 'pending' || !!row.original.reminder?.needsReview"
          @update:model-value="toggle(row.original.submissionId, $event === true)"
        />
      </template>
      <template #applicant-cell="{ row }">
        <p class="font-medium">
          {{ row.original.mappedFields.FullName || [row.original.mappedFields.FirstName, row.original.mappedFields.LastName].filter(Boolean).join(' ') || 'Unnamed applicant' }}
        </p>
        <p class="text-xs text-muted">
          {{ row.original.submissionIdInt || row.original.submissionId }}
        </p>
        <p class="text-xs">
          {{ row.original.mappedFields.Email || row.original.mappedFields.ParentEmail || 'No mapped email' }}
        </p>
      </template>
      <template #opened-cell="{ row }">
        {{ date(row.original.editing.openedForEditingAt) }}
      </template>
      <template #age-cell="{ row }">
        {{ days(row.original.editing.openedForEditingAt) }}
      </template>
      <template #checked-cell="{ row }">
        {{ date(row.original.editing.editingCheckedAt) }}
      </template>
      <template #reminder-cell="{ row }">
        <p>{{ row.original.reminder?.reminderCount || 0 }} sent</p>
        <p class="text-xs">
          {{ row.original.reminder?.lastReminderAt ? date(row.original.reminder.lastReminderAt) : 'Never through this feature' }}
        </p>
        <p
          v-if="row.original.reminder?.needsReview"
          class="text-warning text-xs"
        >
          Reminder pending or delivery/audit requires review — check Jobs and Submittable before sending again.
        </p>
      </template>
      <template #actions-cell="{ row }">
        <div class="flex gap-2">
          <UButton
            label="Details"
            size="xs"
            color="neutral"
            variant="outline"
            @click="detail = row.original; detailOpen = true"
          />
          <UButton
            label="Send reminder"
            size="xs"
            :disabled="status === 'pending' || !!row.original.reminder?.needsReview"
            @click="remind([row.original.submissionId])"
          />
        </div>
      </template>
    </UTable>
    <div class="flex gap-3 items-center justify-between">
      <UButton
        label="Previous"
        color="neutral"
        variant="outline"
        :disabled="page <= 1 || status === 'pending'"
        @click="page--"
      />
      <span class="text-sm">Page {{ page }} of {{ Math.max(1, Math.ceil((data?.total || 0) / 25)) }} · selection is limited to this page</span>
      <UButton
        label="Next"
        color="neutral"
        variant="outline"
        :disabled="page * 25 >= (data?.total || 0) || status === 'pending'"
        @click="page++"
      />
    </div>
    <EditingReminderComposer
      v-model:open="composerOpen"
      :cycle-id="cycleId"
      :submission-ids="recipients"
      @finished="selected = []; refresh()"
    />
    <UModal
      v-model:open="detailOpen"
      title="Editing follow-up details"
      description="Synced application context and reviews; document completeness requires staff review."
      :ui="{ content: '!max-w-4xl' }"
    >
      <template #body>
        <div
          v-if="detail"
          class="space-y-4"
        >
          <p>{{ detail.mappedFields.FullName }} · {{ detail.applicationName }}</p>
          <p class="break-all">
            Submission: {{ detail.submissionIdInt || detail.submissionId }} · Lifecycle status: {{ detail.status }}
          </p>
          <p>Opened: {{ date(detail.editing.openedForEditingAt) }} · Source checked: {{ date(detail.editing.editingCheckedAt) }}</p>
          <SubmissionReviews
            :cycle-id="cycleId"
            :submission-id="detail.submissionId"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
