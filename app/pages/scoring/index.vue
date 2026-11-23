<script setup lang="ts">
import type { SelectItem, TableColumn } from '@nuxt/ui'
import type { DecisionResult } from '../../../server/utils/decisionScoring'
import type { ScoreRecord } from '../../../server/models/ScoreRecord'

interface Cycle { _id: string, year: string, name: string, active: boolean }
interface Application { _id: string, name: string, scoring?: { enabled?: boolean } }
interface PreviewRecord {
  submissionId: string
  applicantName: string
  hsptTaken: boolean
  gpaRecorded: boolean
  essayScored: boolean
  gpa?: { raw?: number | null, source?: string | null, multiplier?: number, bonus?: number, score?: number }
  exam?: { reading?: number, math?: number, language?: number, science?: number, overall?: number }
  essay?: { score?: number | null, reviewCount?: number }
  dpscdBonus: number
  marygroveBonus: number
  marygroveCatchment?: string
  totalAppScore: number | null
  totalMarygroveScore: number | null
  inputsComplete: boolean
  missingInputs: string[]
  decision?: DecisionResult | null
  routingEvaluation?: ScoreRecord['routingEvaluation']
  configFingerprint?: string | null
  compiledAt?: string
  percentiles: Record<string, number | null>
}
interface PreviewResult {
  applicationId: string
  applicationName: string
  placementPathway?: string | null
  supportingComponents: string[]
  summary: { submissions: number, compiled: number, ready: number, missingExam: number, missingGpa: number, missingEssay: number }
  records: PreviewRecord[]
}

const toast = useToast()
const { data: cycles } = await useFetch<Cycle[]>('/api/cycles')
const selectedCycleId = ref('')
const selectedApplicationId = ref('')
const loading = ref(false)
const result = ref<PreviewResult | null>(null)
const search = ref('')
const decisionMode = computed(() => result.value?.placementPathway === 'decision')
type SummaryFilter = 'all' | 'ready' | 'missingExam' | 'missingGpa' | 'missingEssay' | 'proposed' | 'waitlisted' | 'attention'
const summaryFilter = ref<SummaryFilter>('all')

function toggleFilter(filter: SummaryFilter) {
  summaryFilter.value = summaryFilter.value === filter ? 'all' : filter
}

const summaryCards = computed<{ key: SummaryFilter, label: string, value: number }[]>(() => {
  const summary = result.value?.summary
  return [
    { key: 'all', label: 'Compiled', value: summary?.compiled ?? 0 },
    { key: 'ready', label: 'Inputs complete', value: summary?.ready ?? 0 },
    ...(decisionMode.value
      ? [
          { key: 'proposed' as const, label: 'Proposed', value: result.value?.records.filter(record => record.decision?.proposed).length || 0 },
          { key: 'waitlisted' as const, label: 'Waitlisted', value: result.value?.records.filter(record => record.decision?.waitlists.length).length || 0 },
          { key: 'attention' as const, label: 'Needs attention', value: result.value?.records.filter(record => record.decision?.needsAttention).length || 0 }
        ]
      : []),
    { key: 'missingExam', label: 'Missing exam', value: summary?.missingExam ?? 0 },
    { key: 'missingGpa', label: 'Missing GPA', value: summary?.missingGpa ?? 0 },
    { key: 'missingEssay', label: 'Missing essay', value: summary?.missingEssay ?? 0 }
  ]
})

watchEffect(() => {
  const active = cycles.value?.find(cycle => cycle.active)
  if (active && !selectedCycleId.value) selectedCycleId.value = active._id
})

const requestFetch = useRequestFetch()
const { data: applications } = useAsyncData<Application[]>(
  'scoring-applications',
  () => selectedCycleId.value
    ? requestFetch<Application[]>(`/api/applications?cycleId=${selectedCycleId.value}`)
    : Promise.resolve([]),
  { default: () => [], watch: [selectedCycleId] }
)

const cycleItems = computed<SelectItem[]>(() => (cycles.value || []).map(cycle => ({ label: `${cycle.year} — ${cycle.name}`, value: cycle._id })))
const applicationItems = computed<SelectItem[]>(() => (applications.value || []).map(application => ({
  label: application.scoring?.enabled === false ? `${application.name} (scoring off)` : application.name,
  value: application._id
})))

watch(applications, (list) => {
  if (list?.length && !list.some(app => app._id === selectedApplicationId.value)) {
    selectedApplicationId.value = list.find(app => app.scoring?.enabled !== false)?._id || list[0]!._id
  }
}, { immediate: true })

watch(selectedCycleId, () => {
  selectedApplicationId.value = ''
  result.value = null
})

const filteredRecords = computed(() => {
  const query = search.value.trim().toLowerCase()
  let records = result.value?.records || []
  switch (summaryFilter.value) {
    case 'proposed':
      records = records.filter(record => record.decision?.proposed)
      break
    case 'waitlisted':
      records = records.filter(record => record.decision?.waitlists.length)
      break
    case 'attention':
      records = records.filter(record => record.decision?.needsAttention)
      break
    case 'ready':
      records = records.filter(record => record.inputsComplete)
      break
    case 'missingExam':
      records = records.filter(record => record.missingInputs.includes('exam'))
      break
    case 'missingGpa':
      records = records.filter(record => record.missingInputs.includes('gpa'))
      break
    case 'missingEssay':
      records = records.filter(record => record.missingInputs.includes('essay'))
      break
  }
  if (!query) return records
  return records.filter(record =>
    record.applicantName.toLowerCase().includes(query)
    || record.submissionId.toLowerCase().includes(query)
    || String((record as Record<string, unknown>).submissionIdInt ?? '').includes(query)
  )
})

const flagColor = (ok: boolean) => ok ? 'success' : 'error'

const UButton = resolveComponent('UButton')
const sorting = ref([{ id: 'totalAppScore', desc: true }])

function sortableColumn(
  id: string,
  label: string,
  accessorFn: (record: PreviewRecord) => string | number | undefined,
  numeric = true
): TableColumn<PreviewRecord> {
  return {
    id,
    accessorFn,
    enableSorting: true,
    header: ({ column }) => {
      const sorted = column.getIsSorted()
      return h(UButton, {
        color: 'neutral',
        variant: 'ghost',
        label,
        icon: sorted ? (sorted === 'asc' ? 'i-lucide-arrow-up-narrow-wide' : 'i-lucide-arrow-down-wide-narrow') : 'i-lucide-arrow-up-down',
        class: '-mx-2.5',
        onClick: () => column.toggleSorting(sorted === 'asc')
      })
    },
    sortUndefined: 'last',
    sortingFn: numeric ? 'basic' : 'alphanumeric'
  }
}

watch(decisionMode, (enabled) => {
  sorting.value = enabled ? [{ id: 'applicantName', desc: false }] : [{ id: 'totalAppScore', desc: true }]
  summaryFilter.value = 'all'
})
const columns = computed<TableColumn<PreviewRecord>[]>(() => [
  sortableColumn('applicantName', 'Applicant', record => record.applicantName, false),
  sortableColumn('flags', 'Inputs', record => -record.missingInputs.length),
  sortableColumn('gpaScore', 'GPA Score', record => record.gpa?.score ?? undefined),
  sortableColumn('examScore', 'Exam', record => record.exam?.overall ?? undefined),
  sortableColumn('essayScore', 'Essay', record => record.essay?.score ?? undefined),
  sortableColumn('dpscdBonus', 'DPSCD', record => record.dpscdBonus),
  sortableColumn('marygroveBonus', 'MG', record => record.marygroveBonus),
  ...(decisionMode.value
    ? [
        sortableColumn('proposed', 'Proposed choice', record => record.decision?.proposed?.rank),
        { id: 'decision', header: 'School decisions / proposed placement' },
        sortableColumn('waitlists', 'Waitlists', record => record.decision?.waitlists.map(item => `${item.rank || 'Unranked'}: ${item.schoolName}${item.aboveProposal ? ' (above proposal)' : ''}`).join('; '), false)
      ]
    : [
        sortableColumn('totalAppScore', 'Total App', record => record.totalAppScore ?? undefined),
        sortableColumn('totalMarygroveScore', 'Total MG', record => record.totalMarygroveScore ?? undefined),
        sortableColumn('percentileTotal', 'Pctl', record => record.percentiles?.total ?? undefined)
      ])
])

async function runPreview() {
  if (!selectedCycleId.value || !selectedApplicationId.value) return
  loading.value = true
  result.value = null
  try {
    result.value = await $fetch<PreviewResult>('/api/scores/preview', {
      method: 'POST',
      body: { cycleId: selectedCycleId.value, applicationId: selectedApplicationId.value }
    })
  } catch (error: unknown) {
    const message = (error as { data?: { statusMessage?: string } }).data?.statusMessage || 'Preview failed'
    toast.add({ title: message, color: 'error' })
  } finally {
    loading.value = false
  }
}

function formatNumber(value: unknown): string {
  return value == null ? '—' : (typeof value === 'number' ? (Number.isInteger(value) ? String(value) : value.toFixed(2)) : String(value))
}
</script>

<template>
  <UContainer class="py-8">
    <PageHeader
      title="Scoring preview"
      help="scoring"
      class="mb-6"
    >
      <p class="text-muted">
        Preview the score compilation against live data. Nothing is written to the database or Submittable.
      </p>
    </PageHeader>

    <div class="flex flex-wrap items-end gap-3 mb-6">
      <UFormField
        label="Cycle"
        class="w-64"
      >
        <USelect
          v-model="selectedCycleId"
          :items="cycleItems"
          value-key="value"
          placeholder="Select a cycle"
          class="w-full"
        />
      </UFormField>
      <UFormField
        label="Application"
        class="w-72"
      >
        <USelect
          v-model="selectedApplicationId"
          :items="applicationItems"
          value-key="value"
          placeholder="Select an application"
          class="w-full"
        />
      </UFormField>
      <UButton
        label="Run preview"
        icon="i-lucide-play"
        :loading="loading"
        :disabled="!selectedCycleId || !selectedApplicationId"
        @click="runPreview"
      />
    </div>

    <template v-if="result">
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-5 mb-6">
        <UCard
          v-for="card in summaryCards"
          :key="card.key"
          class="cursor-pointer transition-colors"
          :class="summaryFilter === card.key ? 'ring-2 ring-primary' : 'hover:bg-elevated'"
          @click="toggleFilter(card.key)"
        >
          <div class="text-2xl font-semibold">
            {{ card.value }}
          </div>
          <div class="text-sm text-muted">
            {{ card.label }}
          </div>
        </UCard>
      </div>

      <div class="flex items-center justify-between gap-3 mb-3">
        <UInput
          v-model="search"
          icon="i-lucide-search"
          placeholder="Search applicant…"
          class="w-72"
        />
        <span class="text-sm text-muted">{{ filteredRecords.length }} / {{ result.records.length }} rows</span>
      </div>

      <UTable
        v-model:sorting="sorting"
        :data="filteredRecords"
        :columns="columns"
        class="border rounded-lg"
      >
        <template #decision-cell="{ row }">
          <ScoringDecisionScoreDetail
            v-if="row.original.decision"
            :decision="row.original.decision"
            :routing="row.original.routingEvaluation"
            :fingerprint="row.original.configFingerprint"
            :compiled-at="row.original.compiledAt"
          />
        </template>
        <template #flags-cell="{ row }">
          <div class="flex gap-1">
            <UBadge
              :label="result.supportingComponents.includes('exam') ? 'HSPT' : 'HSPT N/A'"
              size="sm"
              :color="result.supportingComponents.includes('exam') ? flagColor(row.original.hsptTaken) : 'neutral'"
              variant="subtle"
            />
            <UBadge
              :label="result.supportingComponents.includes('gpa') ? 'GPA' : 'GPA N/A'"
              size="sm"
              :color="result.supportingComponents.includes('gpa') ? flagColor(row.original.gpaRecorded) : 'neutral'"
              variant="subtle"
            />
            <UBadge
              :label="result.supportingComponents.includes('essay') ? 'Essay' : 'Essay N/A'"
              size="sm"
              :color="result.supportingComponents.includes('essay') ? flagColor(row.original.essayScored) : 'neutral'"
              variant="subtle"
            />
          </div>
        </template>
        <template #gpaScore-cell="{ row }">
          {{ formatNumber(row.original.gpa?.score) }}
          <span
            v-if="row.original.gpa?.raw != null"
            class="text-xs text-muted"
          >({{ row.original.gpa.raw }} · ×{{ row.original.gpa.multiplier }}{{ row.original.gpa.bonus ? ` +${row.original.gpa.bonus}` : '' }})</span>
        </template>
        <template #examScore-cell="{ row }">
          {{ formatNumber(row.original.exam?.overall) }}
        </template>
        <template #essayScore-cell="{ row }">
          {{ formatNumber(row.original.essay?.score) }}
        </template>
        <template #percentileTotal-cell="{ row }">
          {{ formatNumber(row.original.percentiles?.total) }}
        </template>
      </UTable>
    </template>
    <p
      v-else-if="!loading"
      class="text-sm text-muted"
    >
      Select a cycle and application, then run the preview.
    </p>
  </UContainer>
</template>
