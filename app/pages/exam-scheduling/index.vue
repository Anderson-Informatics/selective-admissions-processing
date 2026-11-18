<script setup lang="ts">
import type { SelectItem, TableColumn } from '@nuxt/ui'

interface Cycle { _id: string, year: string, name: string, active: boolean }
interface MessageTemplate { _id: string, name: string }
interface Session { labelId: string, name: string, count: number, date: string }
interface GroupDef { key: string, name: string, entrance: string, arrivalTime: string, schedulable?: boolean }
interface ExamConfig {
  sessionLabelPattern: string
  iep504LabelIds: string[]
  mllLabelId?: string
  messageTemplateId?: string
  testSubmissionId?: string
  groups: Record<string, { min: number, max: number, note?: string }>
  testDurations: Record<'iep504' | 'mll' | 'general', string>
}
interface ExamScheduleData { cycleId: string, config: ExamConfig, sessions: Session[], groups: GroupDef[] }
interface PreviewRow {
  key: string
  name: string
  entrance: string
  arrivalTime: string
  labelNames: string[]
  min: number | null
  max: number | null
  note: string
  count: number
  underMin: boolean
  overMax: boolean
  submissionIds: string[]
}
interface MemberDetail {
  submissionId: string
  submissionIdInt?: number
  fullName: string
  specialLabels: string[]
  accommodations: Array<{ source: string, value: string }>
  reviewNeeded: boolean
  missingRequiredReviews: string[]
}
interface PreviewResult {
  session: Session
  rows: PreviewRow[]
  diagnostics: string[]
  missingLabels: string[]
  members: Record<string, MemberDetail>
  blockers: MemberDetail[]
  reviewWarnings: MemberDetail[]
  assignedCount: number
  unassignedCount: number
}
const sessionDisplay = (session?: Session) => session ? `${session.date} (${session.name})` : ''

const toast = useToast()
const { data: cycles } = await useFetch<Cycle[]>('/api/cycles')
const { data: labelOptions } = await useFetch<SelectItem[]>('/api/routing/labels')
const { data: templates } = await useFetch<MessageTemplate[]>('/api/templates', { default: () => [] })

const selectedCycleId = ref('')
watchEffect(() => {
  const active = cycles.value?.find(cycle => cycle.active)
  if (active && !selectedCycleId.value) selectedCycleId.value = active._id
})
const cycleItems = computed<SelectItem[]>(() => (cycles.value || []).map(cycle => ({ label: `${cycle.year} — ${cycle.name}`, value: cycle._id })))
const templateItems = computed<SelectItem[]>(() => (templates.value || []).map(template => ({ label: template.name, value: template._id })))
const requestFetch = useRequestFetch()
const { data } = await useAsyncData<ExamScheduleData | null>(
  'exam-schedule',
  () => selectedCycleId.value
    ? requestFetch<ExamScheduleData>(`/api/exam-schedule?cycleId=${selectedCycleId.value}`)
    : Promise.resolve(null),
  { default: () => null, watch: [selectedCycleId] }
)

const config = ref<ExamConfig | null>(null)
const schedulableGroups = computed(() => (data.value?.groups || []).filter(group => group.schedulable))
const sessionItems = computed<SelectItem[]>(() => (data.value?.sessions || []).map(session => ({ label: `${session.date} — ${session.name} (${session.count})`, value: session.labelId })))
const selectedSessionId = ref<string | undefined>()

const saving = ref(false)
async function saveConfig() {
  if (!config.value || !data.value) return
  saving.value = true
  try {
    await $fetch('/api/exam-schedule/config', {
      method: 'PUT',
      body: { cycleId: data.value.cycleId, config: config.value }
    })
    previewRequestId++
    previewing.value = false
    preview.value = null
    selectedGroupKey.value = null
    confirmFinalize.value = false
    toast.add({ title: 'Exam scheduling settings saved', color: 'success' })
  } catch (error: unknown) {
    const message = (error as { data?: { statusMessage?: string } }).data?.statusMessage || 'Save failed'
    toast.add({ title: message, color: 'error' })
  } finally {
    saving.value = false
  }
}

const preview = ref<PreviewResult | null>(null)
const previewing = ref(false)
async function runPreview() {
  if (!data.value || !selectedSessionId.value) return
  const requestId = ++previewRequestId
  const cycleId = data.value.cycleId
  const sessionLabelId = selectedSessionId.value
  preview.value = null
  selectedGroupKey.value = null
  confirmFinalize.value = false
  previewing.value = true
  try {
    const result = await $fetch<PreviewResult>('/api/exam-schedule/preview', {
      method: 'POST',
      body: { cycleId, sessionLabelId }
    })
    if (requestId === previewRequestId && selectedCycleId.value === cycleId && selectedSessionId.value === sessionLabelId) preview.value = result
  } catch (error: unknown) {
    const message = (error as { data?: { statusMessage?: string } }).data?.statusMessage || 'Preview failed'
    toast.add({ title: message, color: 'error' })
  } finally {
    if (requestId === previewRequestId) previewing.value = false
  }
}

let previewRequestId = 0
const selectedGroupKey = ref<string | null>(null)
const selectedGroup = computed(() => preview.value?.rows.find(row => row.key === selectedGroupKey.value))
const groupMembers = computed(() => (selectedGroup.value?.submissionIds || []).map(id => preview.value!.members[id]!).filter(Boolean))
const canFinalize = computed(() => Boolean(preview.value && !previewing.value && !preview.value.blockers.length && !preview.value.missingLabels.length))
watch([selectedCycleId, selectedSessionId], () => {
  previewRequestId++
  previewing.value = false
  preview.value = null
  selectedGroupKey.value = null
  confirmFinalize.value = false
})

const testingGroup = ref<string | null>(null)
async function testMessage(groupKey: string) {
  if (!data.value || !selectedSessionId.value) return
  testingGroup.value = groupKey
  try {
    const result = await $fetch<{ unresolved: string[], unknownLibraries: string[] }>('/api/exam-schedule/test-message', {
      method: 'POST',
      body: { cycleId: data.value.cycleId, sessionLabelId: selectedSessionId.value, groupKey }
    })
    const warnings = [...result.unresolved.map(token => `Unresolved: ${token}`), ...result.unknownLibraries.map(key => `Unknown library: ${key}`)]
    toast.add({
      title: 'Test message sent',
      description: warnings.length ? warnings.join('; ') : undefined,
      color: warnings.length ? 'warning' : 'success'
    })
  } catch (error: unknown) {
    const message = (error as { data?: { statusMessage?: string } }).data?.statusMessage || 'Test message failed'
    toast.add({ title: message, color: 'error' })
  } finally {
    testingGroup.value = null
  }
}

const confirmFinalize = ref(false)
const finalizing = ref(false)
watch(data, (value) => {
  config.value = value ? JSON.parse(JSON.stringify(value.config)) : null
  previewRequestId++
  previewing.value = false
  preview.value = null
  selectedGroupKey.value = null
  confirmFinalize.value = false
}, { immediate: true })
async function finalize() {
  if (!data.value || !selectedSessionId.value || !canFinalize.value) return
  finalizing.value = true
  try {
    const result = await $fetch<{ jobId: string, assigned: number }>('/api/exam-schedule/finalize', {
      method: 'POST',
      body: { cycleId: data.value.cycleId, sessionLabelId: selectedSessionId.value }
    })
    confirmFinalize.value = false
    toast.add({
      title: `Finalize job queued for ${result.assigned} submissions`,
      description: 'Follow progress on the Jobs page.',
      color: 'success'
    })
  } catch (error: unknown) {
    const message = (error as { data?: { statusMessage?: string } }).data?.statusMessage || 'Finalize failed'
    toast.add({ title: message, color: 'error' })
  } finally {
    finalizing.value = false
  }
}

const memberColumns: TableColumn<MemberDetail>[] = [
  { accessorKey: 'fullName', header: 'Student' },
  { accessorKey: 'submissionIdInt', header: 'Submission #' },
  { accessorKey: 'specialLabels', header: 'IEP / 504 / MLL' },
  { accessorKey: 'accommodations', header: 'Accommodations' },
  { accessorKey: 'reviewNeeded', header: 'Review status' }
]
const previewColumns = computed<TableColumn<PreviewRow>[]>(() => ([
  { accessorKey: 'name', header: 'Group' },
  { accessorKey: 'entrance', header: 'Entrance' },
  { accessorKey: 'arrivalTime', header: 'Arrival' },
  { accessorKey: 'labelNames', header: 'Labels' },
  { accessorKey: 'count', header: 'Assigned' },
  { id: 'actions', header: '' }
] as TableColumn<PreviewRow>[]).filter(column => !selectedGroupKey.value || !['entrance', 'labelNames', 'actions'].includes('accessorKey' in column ? String(column.accessorKey) : column.id || '')))
</script>

<template>
  <UContainer class="space-y-6 py-8">
    <PageHeader
      title="Exam Scheduling"
      help="examScheduling"
    >
      <template #actions>
        <USelect
          v-model="selectedCycleId"
          :items="cycleItems"
          class="w-56"
          placeholder="Select cycle"
        />
      </template>
    </PageHeader>

    <div
      v-if="data?.sessions.length"
      class="flex flex-wrap gap-3"
    >
      <UCard
        v-for="session in data.sessions"
        :key="session.labelId"
        class="min-w-36"
      >
        <div class="text-sm text-muted">
          {{ session.date }} · {{ session.name }}
        </div>
        <div class="text-2xl font-semibold">
          {{ session.count }}
        </div>
      </UCard>
    </div>
    <UAlert
      v-else-if="data"
      color="info"
      variant="subtle"
      title="No HSPT session labels found"
      description="No submissions in this cycle carry a label matching the session pattern (e.g. “HSPT Jan 10”)."
    />

    <UAccordion
      v-if="config"
      :items="[{ label: 'Scheduling configuration', icon: 'i-lucide-settings' }]"
    >
      <template #content>
        <div class="flex justify-end pb-2">
          <UButton
            label="Save settings"
            :loading="saving"
            @click="saveConfig"
          />
        </div>
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <UFormField label="Message template">
            <USelect
              v-model="config.messageTemplateId"
              :items="templateItems"
              class="w-full"
              placeholder="Select template"
            />
          </UFormField>
          <UFormField label="IEP/504 labels">
            <USelectMenu
              v-model="config.iep504LabelIds"
              :items="labelOptions || []"
              value-key="value"
              multiple
              class="w-full"
              placeholder="Select labels"
            />
          </UFormField>
          <UFormField label="MLL label">
            <USelect
              v-model="config.mllLabelId"
              :items="labelOptions || []"
              value-key="value"
              class="w-full"
              placeholder="Select label"
            />
          </UFormField>
          <UFormField label="Test submission ID">
            <UInput
              v-model="config.testSubmissionId"
              class="w-full"
            />
          </UFormField>
        </div>

        <table class="mt-6 w-full text-sm">
          <thead>
            <tr class="text-left text-muted">
              <th class="pb-2 font-medium">
                Group
              </th>
              <th class="pb-2 font-medium">
                Arrival
              </th>
              <th class="pb-2 font-medium">
                Entrance
              </th>
              <th class="w-28 pb-2 font-medium">
                Min
              </th>
              <th class="w-28 pb-2 font-medium">
                Max
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="group in schedulableGroups"
              :key="group.key"
              class="border-t border-default"
            >
              <td class="py-2 pr-4">
                {{ group.name }}
              </td>
              <td class="py-2 pr-4">
                {{ group.arrivalTime }}
              </td>
              <td class="py-2 pr-4">
                {{ group.entrance }}
              </td>
              <td class="py-2 pr-4">
                <UInput
                  v-model.number="config.groups[group.key]!.min"
                  type="number"
                  :min="0"
                  class="w-24"
                />
              </td>
              <td class="py-2">
                <UInput
                  v-model.number="config.groups[group.key]!.max"
                  type="number"
                  :min="0"
                  class="w-24"
                />
              </td>
            </tr>
          </tbody>
        </table>

        <UFormField
          label="00-Red group note (extra text via {{examSession.note}})"
          class="mt-4"
        >
          <UTextarea
            v-model="config.groups.RED!.note"
            class="w-full"
            :rows="2"
            placeholder="e.g. Please bring a copy of your child's IEP or 504 plan if you would like them to receive testing accommodations."
          />
        </UFormField>

        <div class="mt-4 grid gap-4 sm:grid-cols-3">
          <UFormField
            label="Test duration — General pool ({{examSession.testDuration}})"
            help="Supports **bold**, *italic*, and line breaks in email bodies."
          >
            <UTextarea
              v-model="config.testDurations.general"
              class="w-full"
              :rows="3"
              placeholder="e.g. The exam lasts about 3 hours."
            />
          </UFormField>
          <UFormField label="Test duration — IEP/504">
            <UTextarea
              v-model="config.testDurations.iep504"
              class="w-full"
              :rows="3"
              placeholder="e.g. The exam lasts about 4.5 hours with accommodations."
            />
          </UFormField>
          <UFormField label="Test duration — MLL">
            <UTextarea
              v-model="config.testDurations.mll"
              class="w-full"
              :rows="3"
              placeholder="e.g. The exam lasts about 4 hours."
            />
          </UFormField>
        </div>
      </template>
    </UAccordion>

    <UCard>
      <template #header>
        <div class="flex flex-wrap items-center gap-3">
          <h2 class="font-semibold">
            Schedule preview
          </h2>
          <USelect
            v-model="selectedSessionId"
            :items="sessionItems"
            class="w-64"
            placeholder="Select test date"
          />
          <UButton
            label="Preview schedule"
            icon="i-lucide-eye"
            :loading="previewing"
            :disabled="!selectedSessionId"
            @click="runPreview"
          />
          <UButton
            label="Finalize Schedule and Send Messages"
            icon="i-lucide-send"
            color="primary"
            :disabled="!canFinalize || finalizing"
            @click="confirmFinalize = true"
          />
        </div>
      </template>

      <div v-if="preview">
        <UAlert
          v-if="preview.missingLabels.length"
          color="error"
          variant="subtle"
          class="mb-4"
          title="Missing Submittable labels"
          :description="`Create these labels in Submittable and run metadata sync: ${preview.missingLabels.join(', ')}`"
        />
        <UAlert
          v-if="preview.diagnostics.length"
          color="warning"
          variant="subtle"
          class="mb-4"
          title="Scheduling notes"
          :description="preview.diagnostics.join('; ')"
        />
        <p class="mb-4 text-sm text-muted">
          {{ preview.assignedCount }} assigned · {{ preview.unassignedCount }} unassigned · {{ preview.assignedCount + preview.unassignedCount }} included
        </p>
        <div
          v-for="section in [
            { title: 'Unassigned — Completion review required before finalizing', members: preview.blockers, blocking: true },
            { title: 'IEP/504 Review needed before testing — does not block finalization', members: preview.reviewWarnings, blocking: false }
          ]"
          :key="section.title"
          class="mb-4"
        >
          <UAlert
            v-if="section.members.length"
            :color="section.blocking ? 'error' : 'warning'"
            variant="subtle"
            :title="`${section.title} (${section.members.length})`"
          >
            <template #description>
              <ul class="max-h-64 space-y-1 overflow-y-auto">
                <li
                  v-for="member in section.members"
                  :key="member.submissionId"
                >
                  <a
                    :href="`https://dpscd.submittable.com/submissions/${member.submissionId}`"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="font-medium text-primary hover:underline"
                  >{{ member.fullName || 'Unnamed student' }} — {{ member.submissionIdInt ?? member.submissionId }}</a>
                  <span v-if="!section.blocking"> · {{ member.missingRequiredReviews.join(', ') }}</span>
                </li>
              </ul>
            </template>
          </UAlert>
        </div>
        <div class="flex flex-col gap-4 lg:flex-row">
          <div :class="selectedGroup ? 'min-w-0 lg:w-1/3' : 'min-w-0 w-full'">
            <UTable
              :data="preview.rows"
              :columns="previewColumns"
              @select="(_event, row) => selectedGroupKey = row.original.key"
            >
              <template #name-cell="{ row }">
                <button
                  type="button"
                  class="text-left font-medium text-primary hover:underline"
                  :aria-expanded="selectedGroupKey === row.original.key"
                  @click.stop="selectedGroupKey = row.original.key"
                >
                  {{ row.original.name }}
                </button>
              </template>
              <template #labelNames-cell="{ row }">
                {{ row.original.labelNames.join(' + ') || '—' }}
              </template>
              <template #count-cell="{ row }">
                <UBadge
                  :color="row.original.overMax || row.original.underMin ? 'error' : 'neutral'"
                  variant="subtle"
                >
                  {{ row.original.count }}<template v-if="row.original.max != null">
                    / {{ row.original.min }}–{{ row.original.max }}
                  </template>
                </UBadge>
              </template>
              <template #actions-cell="{ row }">
                <UButton
                  label="Test message"
                  size="xs"
                  variant="outline"
                  :loading="testingGroup === row.original.key"
                  @click.stop="testMessage(row.original.key)"
                />
              </template>
            </UTable>
          </div>
          <Transition
            enter-active-class="motion-safe:transition motion-safe:duration-200"
            enter-from-class="translate-x-4 opacity-0 motion-reduce:translate-x-0"
            enter-to-class="translate-x-0 opacity-100"
          >
            <section
              v-if="selectedGroup"
              class="min-w-0 flex-1 rounded-lg border border-default p-3"
              aria-label="Group members"
            >
              <div class="mb-3 flex items-center justify-between gap-2">
                <h3 class="font-semibold">
                  {{ selectedGroup.name }} ({{ groupMembers.length }})
                </h3>
                <UButton
                  icon="i-lucide-x"
                  aria-label="Close group members"
                  variant="ghost"
                  color="neutral"
                  @click="selectedGroupKey = null"
                />
              </div>
              <UTable
                :data="groupMembers"
                :columns="memberColumns"
                empty="No students assigned to this group."
              >
                <template #fullName-cell="{ row }">
                  <a
                    :href="`https://dpscd.submittable.com/submissions/${row.original.submissionId}`"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="font-medium text-primary hover:underline"
                  >{{ row.original.fullName || 'Unnamed student' }}</a>
                </template>
                <template #specialLabels-cell="{ row }">
                  {{ row.original.specialLabels.join(', ') || '—' }}
                </template>
                <template #accommodations-cell="{ row }">
                  <div
                    v-for="item in row.original.accommodations"
                    :key="item.source"
                    class="whitespace-normal"
                  >
                    {{ item.source }}: {{ item.value }}
                  </div>
                  <span v-if="!row.original.accommodations.length">—</span>
                </template>
                <template #reviewNeeded-cell="{ row }">
                  <UBadge
                    v-if="row.original.reviewNeeded"
                    color="warning"
                    variant="subtle"
                    class="whitespace-normal"
                  >
                    Review needed before testing
                  </UBadge>
                  <span v-else>—</span>
                </template>
              </UTable>
            </section>
          </Transition>
        </div>
      </div>
      <p
        v-else
        class="text-sm text-muted"
      >
        Select a test date and run a preview to see the proposed groups.
      </p>
    </UCard>

    <UModal
      v-model:open="confirmFinalize"
      title="Finalize schedule?"
    >
      <template #body>
        <p class="text-sm">
          This applies the exam and color labels in Submittable for
          <strong>{{ sessionDisplay(preview?.session) }}</strong> and sends the configured
          message to every assigned applicant as a background job. This cannot be undone.
        </p>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton
            label="Cancel"
            variant="outline"
            @click="confirmFinalize = false"
          />
          <UButton
            label="Finalize and send"
            color="primary"
            :loading="finalizing"
            :disabled="!canFinalize"
            @click="finalize"
          />
        </div>
      </template>
    </UModal>
  </UContainer>
</template>
