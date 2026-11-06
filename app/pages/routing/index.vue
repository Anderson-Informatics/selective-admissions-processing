<script setup lang="ts">
import type { SelectItem, TableColumn } from '@nuxt/ui'

interface Cycle { _id: string, year: string, name: string, active: boolean }
interface Application { _id: string, name: string }
interface PreviewMove { submissionId: string, applicantName: string, applicationName: string, currentStage: string, proposedStage: string, reason: string, backward: boolean }
interface LedgerEntry { stageId: string, name: string, order: number, role: string, required: boolean, status: string, complete: boolean }
interface SubmissionDetail { submissionId: string, applicantName: string, applicationName: string, currentStage: string, proposedStage?: string | null, decision: string, backward: boolean, diagnostics: Array<{ code: string, message: string }>, reviewCompletion: LedgerEntry[] }
interface PreviewResult {
  evaluated: number
  noAction: number
  proposedMoves: PreviewMove[]
  submissionDetails: SubmissionDetail[]
  diagnostics: Array<{ submissionId?: string, code: string, message: string }>
  byTargetStage: Record<string, number>
  limit: number
}

const toast = useToast()
const { data: cycles } = await useFetch<Cycle[]>('/api/cycles')
const { data: labels, error: labelsError } = await useFetch<SelectItem[]>('/api/routing/labels')
const selectedCycleId = ref('')
const ALL_APPLICATIONS = '__all__'
const ALL_LABELS = '__all__'
const selectedApplicationId = ref(ALL_APPLICATIONS)
const selectedLabelId = ref(ALL_LABELS)
const limit = ref(250)
const loading = ref(false)
const result = ref<PreviewResult | null>(null)
const selectedDetail = ref<SubmissionDetail | null>(null)
const detailModalOpen = ref(false)

watchEffect(() => {
  const active = cycles.value?.find(cycle => cycle.active)
  if (active && !selectedCycleId.value) selectedCycleId.value = active._id
})

const requestFetch = useRequestFetch()
const { data: applications, status: applicationsStatus, error: applicationsError } = useAsyncData<Application[]>(
  'routing-applications',
  () => selectedCycleId.value
    ? requestFetch<Application[]>(`/api/applications?cycleId=${selectedCycleId.value}`)
    : Promise.resolve([]),
  {
    default: () => [],
    watch: [selectedCycleId]
  }
)
const cycleItems = computed<SelectItem[]>(() => (cycles.value || []).map(cycle => ({ label: `${cycle.year} — ${cycle.name}`, value: cycle._id })))
const applicationItems = computed<SelectItem[]>(() => [
  { label: 'All applications', value: ALL_APPLICATIONS },
  ...(applications.value || []).map(application => ({ label: application.name, value: application._id }))
])
const labelItems = computed<SelectItem[]>(() => [
  { label: 'All labels', value: ALL_LABELS },
  ...(labels.value || [])
])

watch(selectedCycleId, () => {
  selectedApplicationId.value = ALL_APPLICATIONS
  selectedLabelId.value = ALL_LABELS
  result.value = null
})
watch([selectedApplicationId, selectedLabelId], () => {
  result.value = null
})

async function previewRouting() {
  if (!selectedCycleId.value) return
  loading.value = true
  try {
    result.value = await $fetch<PreviewResult>('/api/routing/preview', {
      method: 'POST',
      body: {
        cycleId: selectedCycleId.value,
        applicationId: selectedApplicationId.value === ALL_APPLICATIONS ? undefined : selectedApplicationId.value,
        labelId: selectedLabelId.value === ALL_LABELS ? undefined : selectedLabelId.value,
        limit: limit.value
      }
    })
    stageFilter.value = null
    toast.add({ title: 'Routing preview complete', color: 'success' })
  } catch (error: unknown) {
    const message = (error as { data?: { statusMessage?: string } }).data?.statusMessage || 'Routing preview failed'
    toast.add({ title: message, color: 'error' })
  } finally {
    loading.value = false
  }
}

const confirmOpen = ref(false)
const executing = ref(false)
const dryRun = ref(false)

async function executeRouting() {
  if (!selectedCycleId.value) return
  executing.value = true
  try {
    await $fetch('/api/jobs', {
      method: 'POST',
      body: {
        type: 'run_routing',
        cycleId: selectedCycleId.value,
        payload: {
          applicationId: selectedApplicationId.value === ALL_APPLICATIONS ? undefined : selectedApplicationId.value,
          labelId: selectedLabelId.value === ALL_LABELS ? undefined : selectedLabelId.value,
          limit: limit.value,
          dryRun: dryRun.value
        }
      }
    })
    confirmOpen.value = false
    toast.add({
      title: dryRun.value ? 'Routing dry run queued' : 'Routing execution queued',
      description: 'Track progress on the Jobs page.',
      color: 'success',
      actions: [{ label: 'View jobs', to: '/jobs' }]
    })
  } catch (error: unknown) {
    const message = (error as { data?: { statusMessage?: string } }).data?.statusMessage || 'Failed to queue routing job'
    toast.add({ title: message, color: 'error' })
  } finally {
    executing.value = false
  }
}

const columns: TableColumn<SubmissionDetail>[] = [
  { accessorKey: 'applicantName', header: 'Applicant Name' },
  { accessorKey: 'currentStage', header: 'Current stage' },
  { accessorKey: 'proposedStage', header: 'Proposed stage' },
  { accessorKey: 'decision', header: 'Reason' },
  { id: 'warning', header: 'Warning', enableSorting: false },
  { id: 'details', header: 'Ledger', enableSorting: false }
]

const stageFilter = ref<string | null>(null)
const filteredDetails = computed(() => {
  const details = result.value?.submissionDetails || []
  return stageFilter.value ? details.filter(detail => detail.proposedStage === stageFilter.value) : details
})

function toggleStageFilter(stage: string) {
  stageFilter.value = stageFilter.value === stage ? null : stage
}

const ledgerColumns: TableColumn<LedgerEntry>[] = [
  { accessorKey: 'order', header: 'Order' },
  { accessorKey: 'name', header: 'Stage' },
  { accessorKey: 'role', header: 'Role' },
  { accessorKey: 'required', header: 'Required' },
  { accessorKey: 'status', header: 'Status' },
  { accessorKey: 'complete', header: 'Complete' }
]

const requiredLedgerEntries = computed(() => (selectedDetail.value?.reviewCompletion || []).filter(entry => entry.required))
const optionalLedgerEntries = computed(() => (selectedDetail.value?.reviewCompletion || []).filter(entry => !entry.required))

function openDetail(detail: SubmissionDetail) {
  selectedDetail.value = detail
  detailModalOpen.value = true
}
</script>

<template>
  <UContainer class="py-8">
    <h1 class="text-2xl font-semibold mb-2">
      Routing Preview
    </h1>
    <p class="text-muted mb-6">
      Read-only evaluation of the configured routing rules. This does not move submissions or modify Submittable.
    </p>

    <div class="flex flex-wrap items-end gap-4 mb-6">
      <UFormField label="Admission cycle">
        <USelect
          v-model="selectedCycleId"
          :items="cycleItems"
          class="w-72"
        />
      </UFormField>
      <UFormField label="Application">
        <USelect
          v-model="selectedApplicationId"
          :items="applicationItems"
          class="w-72"
        />
      </UFormField>
      <UFormField label="Label">
        <USelect
          v-model="selectedLabelId"
          :items="labelItems"
          class="w-72"
        />
      </UFormField>
      <UFormField label="Maximum submissions">
        <UInput
          v-model.number="limit"
          type="number"
          min="1"
          max="500"
          class="w-28"
        />
      </UFormField>
      <UButton
        label="Preview routing"
        :loading="loading"
        :disabled="!selectedCycleId"
        @click="previewRouting"
      />
      <UButton
        label="Execute routing"
        color="warning"
        variant="outline"
        :disabled="!selectedCycleId"
        @click="confirmOpen = true"
      />
    </div>

    <UAlert
      v-if="labelsError"
      title="Labels could not be loaded"
      description="Check your session and try again."
      color="error"
      variant="subtle"
      class="mb-6"
    />
    <UAlert
      v-if="applicationsError"
      title="Applications could not be loaded"
      description="Check your session and try again."
      color="error"
      variant="subtle"
      class="mb-6"
    />
    <UAlert
      v-else-if="applicationsStatus !== 'pending' && selectedCycleId && !applications?.length"
      title="No applications configured for this cycle"
      description="Select a different admission cycle or map a Submittable project on the Applications page before running a routing preview."
      color="warning"
      variant="subtle"
      class="mb-6"
    />

    <div
      v-if="result"
      class="space-y-6"
    >
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        <UCard>
          <p class="text-sm text-muted">
            Evaluated
          </p><p class="text-2xl font-semibold">
            {{ result.evaluated }}
          </p>
        </UCard>
        <UCard>
          <p class="text-sm text-muted">
            Proposed moves
          </p><p class="text-2xl font-semibold">
            {{ result.proposedMoves.length }}
          </p>
        </UCard>
        <UCard>
          <p class="text-sm text-muted">
            No action
          </p><p class="text-2xl font-semibold">
            {{ result.noAction }}
          </p>
        </UCard>
        <UCard>
          <p class="text-sm text-muted">
            Diagnostics
          </p><p class="text-2xl font-semibold">
            {{ result.diagnostics.length }}
          </p>
        </UCard>
      </div>

      <UCard v-if="Object.keys(result.byTargetStage).length">
        <template #header>
          <h2 class="font-medium">
            Proposed destinations
          </h2>
        </template>
        <div class="flex flex-wrap gap-2">
          <UBadge
            v-for="(count, stage) in result.byTargetStage"
            :key="stage"
            :label="`${stage}: ${count}`"
            :color="stageFilter === stage ? 'primary' : 'neutral'"
            :variant="stageFilter === stage ? 'solid' : 'subtle'"
            class="cursor-pointer"
            @click="toggleStageFilter(String(stage))"
          />
        </div>
        <p
          v-if="stageFilter"
          class="text-sm text-muted mt-2"
        >
          Filtering to "{{ stageFilter }}". Click the tag again to clear.
        </p>
      </UCard>

      <UAlert
        v-if="result.diagnostics.length"
        title="Routing diagnostics"
        color="warning"
        variant="subtle"
      >
        <template #description>
          <ul class="list-disc ps-5">
            <li
              v-for="diagnostic in result.diagnostics"
              :key="`${diagnostic.submissionId}-${diagnostic.code}-${diagnostic.message}`"
            >
              {{ diagnostic.submissionId ? `${diagnostic.submissionId}: ` : '' }}{{ diagnostic.message }}
            </li>
          </ul>
        </template>
      </UAlert>

      <UTable
        :data="filteredDetails"
        :columns="columns"
        class="border rounded-lg"
      >
        <template #applicantName-cell="{ row }">
          <a
            :href="`https://dpscd.submittable.com/submissions/${row.original.submissionId}`"
            target="_blank"
            rel="noopener noreferrer"
            class="font-medium text-primary hover:underline"
          >
            {{ row.original.applicantName }}
          </a>
        </template>
        <template #proposedStage-cell="{ row }">
          {{ row.original.proposedStage || '—' }}
        </template>
        <template #warning-cell="{ row }">
          <UBadge
            v-if="row.original.backward"
            label="Backward move"
            color="warning"
            variant="subtle"
          />
          <span
            v-else
            class="text-muted"
          >—</span>
        </template>
        <template #details-cell="{ row }">
          <UButton
            size="xs"
            label="View ledger"
            color="neutral"
            variant="soft"
            @click="openDetail(row.original)"
          />
        </template>
      </UTable>
    </div>

    <UModal
      v-model:open="confirmOpen"
      title="Execute routing?"
    >
      <template #body>
        <div class="space-y-3 text-sm">
          <p>
            This queues a routing job for the selected cycle{{ selectedApplicationId !== ALL_APPLICATIONS ? ', application' : '' }}{{ selectedLabelId !== ALL_LABELS ? ' and label' : '' }}. The job re-evaluates live data, so results may differ from the last preview.
          </p>
          <UAlert
            color="warning"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="This writes to Submittable"
            description="Stage moves, label changes, and reviewer assignments are applied. Stages configured with an Open-for-Editing action will send an email to the applicant."
          />
          <UCheckbox
            v-model="dryRun"
            label="Dry run — evaluate only, no Submittable writes"
          />
        </div>
      </template>
      <template #footer="{ close }">
        <div class="flex justify-end gap-2">
          <UButton
            label="Cancel"
            color="neutral"
            variant="outline"
            @click="close"
          />
          <UButton
            :label="dryRun ? 'Queue dry run' : 'Queue routing job'"
            color="warning"
            :loading="executing"
            @click="executeRouting"
          />
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="detailModalOpen"
      title="Review completion ledger"
      :ui="{ content: '!max-w-7xl' }"
    >
      <template #body>
        <div
          v-if="selectedDetail"
          class="space-y-4"
        >
          <div class="text-sm text-muted">
            {{ selectedDetail.applicantName }} — {{ selectedDetail.currentStage }} → {{ selectedDetail.proposedStage || 'No move' }}
          </div>
          <div>
            <h3 class="font-medium mb-2">
              Required stages
            </h3>
            <UTable
              :data="requiredLedgerEntries"
              :columns="ledgerColumns"
              class="border rounded-lg"
            >
              <template #required-cell="{ row }">
                <UBadge
                  :label="row.original.required ? 'Yes' : 'No'"
                  :color="row.original.required ? 'warning' : 'neutral'"
                  variant="subtle"
                />
              </template>
              <template #complete-cell="{ row }">
                <UBadge
                  :label="row.original.complete ? 'Yes' : 'No'"
                  :color="row.original.complete ? 'success' : 'neutral'"
                  variant="subtle"
                />
              </template>
            </UTable>
          </div>
          <div>
            <h3 class="font-medium mb-2">
              Optional stages
            </h3>
            <UTable
              :data="optionalLedgerEntries"
              :columns="ledgerColumns"
              class="border rounded-lg"
            >
              <template #required-cell="{ row }">
                <UBadge
                  :label="row.original.required ? 'Yes' : 'No'"
                  :color="row.original.required ? 'warning' : 'neutral'"
                  variant="subtle"
                />
              </template>
              <template #complete-cell="{ row }">
                <UBadge
                  :label="row.original.complete ? 'Yes' : 'No'"
                  :color="row.original.complete ? 'success' : 'neutral'"
                  variant="subtle"
                />
              </template>
            </UTable>
          </div>
          <UAlert
            v-if="selectedDetail.diagnostics.length"
            title="Submission diagnostics"
            color="warning"
            variant="subtle"
          >
            <template #description>
              <ul class="list-disc ps-5">
                <li
                  v-for="diagnostic in selectedDetail.diagnostics"
                  :key="`${diagnostic.code}-${diagnostic.message}`"
                >
                  {{ diagnostic.message }}
                </li>
              </ul>
            </template>
          </UAlert>
        </div>
      </template>
      <template #footer="{ close }">
        <UButton
          label="Close"
          color="neutral"
          variant="outline"
          @click="close"
        />
      </template>
    </UModal>
  </UContainer>
</template>
