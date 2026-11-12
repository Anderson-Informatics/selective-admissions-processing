<script setup lang="ts">
import type { SelectItem, TableColumn } from '@nuxt/ui'
import RoutingConfigEditor from '../../components/routing/RoutingConfigEditor.vue'
import { copyRoutingConfig, unmappedCopiedReviewFields, type CopyScope, type RoutingConfig } from '../../components/routing/copyRoutingConfig'

interface ReviewStage {
  _id?: string
  stageId: string
  name: string
  type: string
  formId?: string
  order: number
  role: 'initial' | 'work' | 'hold' | 'final'
  routing: RoutingConfig
  routingDraft?: RoutingConfig
  routingDraftUpdatedAt?: string
  routingPublishedAt?: string
  routingDraftVersion?: number
}
interface ApplicationRound { key: string, name: string, order: number, startDate: string, endDate: string, active: boolean }
interface ScoringConfig {
  enabled: boolean
  components: string[]
  requireComplete: boolean
  gpaBonusPoints: number
  dpscdBonusPoints: number
  marygroveBonuses: { primary: number, secondary: number }
  internalForm: { formId: string, fields: Record<string, InternalFieldMapping> }
}
interface Application { _id: string, cycleId: string, name: string, type: string, projectId: string, initialFormId?: string, active: boolean, rounds?: ApplicationRound[], scoring?: Partial<ScoringConfig>, placementPathway?: string | null, stages: ReviewStage[] }
interface Template { key: string, name: string, description?: string, draft?: boolean }
interface References { stages: SelectItem[], fields: SelectItem[], rounds: SelectItem[], labels: SelectItem[], users: SelectItem[], reviewFields: Array<{ stageId: string, fields: SelectItem[] }> }

const route = useRoute()
const router = useRouter()
const toast = useToast()
const apiRequest = $fetch as unknown as (url: string, options: { method: 'PUT', body?: unknown }) => Promise<unknown>
const loading = ref(false)
const publishing = ref(false)
const activeTab = ref('routing')
const tabItems = [
  { label: 'General', value: 'general' },
  { label: 'Rounds', value: 'rounds' },
  { label: 'Routing', value: 'routing' },
  { label: 'Scoring', value: 'scoring' }
]
const selectedStageIndex = ref<number | null>(null)
const selectedTemplate = ref('')
const templateWarnings = ref<string[]>([])
const copyOpen = ref(false)
const copySourceId = ref('')
const copyTargetId = ref('')
const copyScope = ref<CopyScope>('all')
const draftState = ref<'saved' | 'saving' | 'error'>('saved')
const autosaveTimers = new Map<string, ReturnType<typeof setTimeout>>()
const draftSaves = new Map<string, Promise<void>>()
const failedDraftIds = new Set<string>()

const emptyRouting = (): RoutingConfig => ({ enabled: false, statusRules: [], outcomeRules: [], entryActions: [], exitActions: [] })
const { data: application, status, refresh } = await useFetch<Application>(`/api/applications/${route.params.id}`)
const { data: templates } = await useFetch<Template[]>('/api/applications/templates')
const { data: references } = await useFetch<References>(`/api/applications/${route.params.id}/routing-references`)
const emptyScoring = (): ScoringConfig => ({
  enabled: false,
  components: ['gpa', 'exam', 'essay', 'dpscdBonus', 'marygroveBonus'],
  requireComplete: true,
  gpaBonusPoints: 5,
  dpscdBonusPoints: 10,
  marygroveBonuses: { primary: 10, secondary: 5 },
  internalForm: { formId: '', fields: {} }
})
const state = reactive({ name: '', type: 'exam', active: true, rounds: [] as ApplicationRound[], stages: [] as ReviewStage[], scoring: emptyScoring(), placementPathway: null as string | null })
const selectedStage = computed(() => selectedStageIndex.value == null ? undefined : state.stages[selectedStageIndex.value])
const copySource = computed(() => state.stages.find(stage => stage.stageId === copySourceId.value))
const copyTarget = computed(() => state.stages.find(stage => stage.stageId === copyTargetId.value))
const copySourceItems = computed(() => state.stages.filter(stage => stage.stageId !== copyTargetId.value).map(stage => ({ label: stage.name, value: stage.stageId })))
const copyScopes: Array<{ label: string, value: CopyScope }> = [
  { label: 'Entire routing config', value: 'all' },
  { label: 'Required When', value: 'requiredWhen' },
  { label: 'Status Rules', value: 'statusRules' },
  { label: 'Status Labels', value: 'statusLabels' },
  { label: 'Outcome Rules', value: 'outcomeRules' },
  { label: 'Entry Actions', value: 'entryActions' },
  { label: 'Exit Actions', value: 'exitActions' }
]
const copyWarnings = computed(() => {
  if (!copySource.value || !copyTarget.value || !references.value) return []
  const copied = copyRoutingConfig(
    copySource.value.routingDraft || copySource.value.routing,
    copyTarget.value.routingDraft || copyTarget.value.routing,
    copySource.value.stageId,
    copyTarget.value.stageId,
    copyScope.value
  )
  const fields = references.value.reviewFields.find(item => item.stageId === copyTarget.value?.stageId)?.fields || []
  return unmappedCopiedReviewFields(copied, copyTarget.value.stageId, fields.map(item => String(typeof item === 'object' && item !== null && 'value' in item ? item.value : item)), copyScope.value)
})
const stageColumns: TableColumn<ReviewStage>[] = [
  { accessorKey: 'order', header: 'Order' },
  { accessorKey: 'name', header: 'Stage' },
  { accessorKey: 'role', header: 'Role' },
  { id: 'routing', header: 'Routing', enableSorting: false }
]
const roleItems: SelectItem[] = [
  { label: 'Initial', value: 'initial' },
  { label: 'Work', value: 'work' },
  { label: 'Hold', value: 'hold' },
  { label: 'Final', value: 'final' }
]

function formatRoundDate(value?: string): string {
  if (!value) return ''
  return new Date(value).toISOString().split('T')[0] || ''
}

watchEffect(() => {
  if (!application.value || state.stages.length) return
  state.name = application.value.name
  state.type = application.value.type
  state.active = application.value.active
  state.rounds = (application.value.rounds || []).map(round => ({
    key: round.key,
    name: round.name,
    order: round.order,
    startDate: formatRoundDate(round.startDate),
    endDate: formatRoundDate(round.endDate),
    active: round.active !== false
  }))
  const scoring = { ...emptyScoring(), ...(application.value.scoring || {}) }
  scoring.internalForm = { ...emptyScoring().internalForm, ...(application.value.scoring?.internalForm || {}) }
  scoring.marygroveBonuses = { ...emptyScoring().marygroveBonuses, ...(application.value.scoring?.marygroveBonuses || {}) }
  state.scoring = scoring
  state.placementPathway = application.value.placementPathway ?? 'none'
  state.stages = (application.value.stages || []).map(stage => ({
    ...stage,
    role: stage.role || 'work',
    routing: stage.routing || emptyRouting(),
    routingDraft: stage.routingDraftVersion ? (stage.routingDraft || stage.routing) : (stage.routing || emptyRouting())
  }))
  if (state.stages.length) selectedStageIndex.value = 0
})

function selectStage(index: number) {
  selectedStageIndex.value = index
}

function openCopy() {
  if (!selectedStage.value) return
  copyTargetId.value = selectedStage.value.stageId
  copySourceId.value = ''
  copyScope.value = 'all'
  copyOpen.value = true
}

function applyCopy() {
  const source = copySource.value
  const target = copyTarget.value
  if (!source || !target || !references.value || source.stageId === target.stageId) return
  const warnings = copyWarnings.value
  target.routingDraft = copyRoutingConfig(
    source.routingDraft || source.routing,
    target.routingDraft || target.routing,
    source.stageId,
    target.stageId,
    copyScope.value
  )
  scheduleDraftSave(target)
  copyOpen.value = false
  toast.add({
    title: `${copyScopes.find(item => item.value === copyScope.value)?.label} copied to ${target.name} draft`,
    description: warnings.length ? `Review fields not mapped on ${target.name}: ${warnings.join(', ')}` : undefined,
    color: warnings.length ? 'warning' : 'success'
  })
}

async function saveDraft(stage: ReviewStage) {
  const previous = draftSaves.get(stage.stageId)
  const save = (async () => {
    if (previous) await previous.catch(() => {})
    await $fetch(`/api/applications/${application.value?._id}/stages/${stage.stageId}`, {
      method: 'PATCH',
      body: { routing: stage.routingDraft || emptyRouting() }
    })
  })()
  draftSaves.set(stage.stageId, save)
  try {
    await save
    failedDraftIds.delete(stage.stageId)
    draftState.value = 'saved'
  } catch (error) {
    failedDraftIds.add(stage.stageId)
    draftState.value = 'error'
    throw error
  } finally {
    if (draftSaves.get(stage.stageId) === save) draftSaves.delete(stage.stageId)
  }
}

function scheduleDraftSave(stage: ReviewStage) {
  const timer = autosaveTimers.get(stage.stageId)
  if (timer) clearTimeout(timer)
  draftState.value = 'saving'
  autosaveTimers.set(stage.stageId, setTimeout(() => {
    autosaveTimers.delete(stage.stageId)
    void saveDraft(stage).catch(() => {})
  }, 500))
}

async function flushDraftSaves() {
  const pending = [...autosaveTimers.keys()]
  for (const id of pending) {
    const timer = autosaveTimers.get(id)
    if (timer) clearTimeout(timer)
    autosaveTimers.delete(id)
  }
  await Promise.all(pending.map((id) => {
    const stage = state.stages.find(item => item.stageId === id)
    return stage ? saveDraft(stage) : Promise.resolve()
  }))
  await Promise.all(draftSaves.values())
  if (failedDraftIds.size) throw new Error('Draft save failed; routing was not published')
}

function updateDraft(value: RoutingConfig) {
  const stage = selectedStage.value
  if (!stage) return
  stage.routingDraft = value
  scheduleDraftSave(stage)
}

async function publishDraft() {
  if (!application.value) return
  publishing.value = true
  try {
    await flushDraftSaves()
    const result = await $fetch<{ stages: ReviewStage[] }>(`/api/applications/${application.value._id}/routing-publish`, { method: 'POST' })
    state.stages = result.stages.map(stage => ({ ...stage, routingDraft: stage.routingDraft || stage.routing }))
    toast.add({ title: 'Routing configuration published', color: 'success' })
  } catch (error: unknown) {
    const message = (error as { data?: { statusMessage?: string } }).data?.statusMessage || (error instanceof Error ? error.message : 'Failed to publish routing configuration')
    toast.add({ title: message, color: 'error' })
  } finally {
    publishing.value = false
  }
}

async function discardDraft() {
  if (!application.value || !confirm('Discard all routing draft changes?')) return
  for (const timer of autosaveTimers.values()) clearTimeout(timer)
  autosaveTimers.clear()
  await Promise.allSettled(draftSaves.values())
  await $fetch(`/api/applications/${application.value._id}/routing-discard`, { method: 'POST' })
  await refresh()
  state.stages = (application.value?.stages || []).map(stage => ({ ...stage, routingDraft: stage.routingDraft || stage.routing }))
  failedDraftIds.clear()
  draftState.value = 'saved'
  toast.add({ title: 'Routing draft discarded', color: 'success' })
}

const componentItems: SelectItem[] = [
  { label: 'GPA', value: 'gpa' },
  { label: 'Exam (HSPT)', value: 'exam' },
  { label: 'Essay', value: 'essay' },
  { label: 'DPSCD bonus', value: 'dpscdBonus' },
  { label: 'Marygrove bonus', value: 'marygroveBonus' }
]
const pathwayItems: SelectItem[] = [
  { label: 'None', value: 'none' },
  { label: 'Score-based', value: 'score' },
  { label: 'Decision-based', value: 'decision' }
]
interface InternalFieldMapping { source: string, field: string, default?: unknown }
const MAPPING_SOURCES: SelectItem[] = [
  { label: '— Unmapped —', value: 'unmapped' },
  { label: 'Scoring', value: 'scoring' },
  { label: 'HSPT', value: 'hspt' },
  { label: 'GPA', value: 'gpa' },
  { label: 'Submission', value: 'submission' },
  { label: 'Placement', value: 'placement' },
  { label: 'Completion', value: 'condition' },
  { label: 'Literal text', value: 'literal' }
]
const MAPPING_SOURCE_FIELDS: Record<string, string[]> = {
  scoring: [
    'totalAppScore', 'totalMarygroveScore', 'exam.overall', 'exam.reading', 'exam.math', 'exam.language', 'exam.science',
    'gpa.raw', 'gpa.source', 'gpa.multiplier', 'gpa.score', 'gpa.bonus', 'essay.score', 'essay.reviewCount',
    'dpscdBonus', 'marygroveBonus', 'marygroveCatchment',
    'percentiles.total', 'percentiles.gpa', 'percentiles.essay', 'percentiles.exam',
    'percentiles.examReading', 'percentiles.examMath', 'percentiles.examLanguage', 'percentiles.examScience'
  ],
  hspt: [
    'overall', 'reading', 'math', 'language', 'science', 'rdrs', 'mtrs', 'lnrs', 'oprs',
    'rdnp', 'mtnp', 'lnnp', 'opnp', 'rdlp', 'mtlp', 'lnlp', 'oplp', 'rdge', 'mtge', 'lnge',
    'optCd', 'hpid', 'testCenter', 'batch', 'form', 'birth', 'matchType', 'sourceFile'
  ],
  gpa: [
    'resolvedCumulativeGpa', 'resolvedSource', 'gpaMultiplier', 'gpaBonusEligible', 'gpaBonus', 'gpaScore',
    'dpscd.cumulativeGpa', 'dpscd.quartersAvailable', 'dpscd.gpaStatus', 'dpscd.studentNumber', 'dpscd.studentName',
    'dpscd.dob', 'dpscd.schoolNumber', 'dpscd.schoolName', 'dpscd.gradeLevel', 'dpscd.minimumEntryDate', 'dpscd.latestExitDate',
    'optIn.cumulativeGpa', 'optIn.schoolName', 'optIn.termsEnrolled', 'optIn.enrolledMinTerms'
  ],
  submission: [
    'submissionId', 'submissionIdInt', 'status', 'currentStageName', 'roundKey', 'roundName',
    'mappedFields.FullName', 'mappedFields.FirstName', 'mappedFields.LastName', 'mappedFields.DOB',
    'mappedFields.FirstChoiceSchool', 'mappedFields.SecondChoiceSchool', 'mappedFields.ThirdChoiceSchool',
    'mappedFields.FourthChoiceSchool', 'mappedFields.FifthChoiceSchool', 'mappedFields.StudentNumber',
    'mappedFields.DPSCD', 'mappedFields.GradeEntering', 'mappedFields.Address1', 'mappedFields.City',
    'mappedFields.State', 'mappedFields.Zip'
  ],
  placement: [],
  condition: [
    'hsptTaken', 'gpaRecorded', 'essayScored', 'ready', 'gpaStatus', 'gpaDpscd', 'gpaOptIn',
    'roundKey', 'roundName', 'currentStageId', 'currentStageName'
  ]
}
const internalFormName = ref('')
const internalFormFields = ref<{ formFieldId: string, label: string, fieldType: string, options?: { formOptionId: string, label: string }[] }[]>([])
const internalFormLoading = ref(false)
const internalFormError = ref('')
const WRITABLE_FIELD_TYPES = new Set(['number', 'short_answer', 'long_answer', 'single_checkbox', 'single_response', 'multiple_response', 'date'])

watch(() => state.scoring.internalForm.formId, async (formId) => {
  internalFormError.value = ''
  internalFormFields.value = []
  internalFormName.value = ''
  if (!formId?.trim() || !application.value?.cycleId) return
  internalFormLoading.value = true
  try {
    const form = await $fetch<{ name?: string, fields: { formFieldId: string, label: string, fieldType: string, subField?: string, options?: { formOptionId: string, label: string }[] }[] }>(
      `/api/forms/${formId.trim()}`,
      { query: { cycleId: application.value.cycleId } }
    )
    internalFormName.value = form.name || ''
    internalFormFields.value = (form.fields || [])
      .filter(field => !field.subField && WRITABLE_FIELD_TYPES.has(field.fieldType))
      .map(field => ({ formFieldId: field.formFieldId, label: field.label, fieldType: field.fieldType, options: field.options }))
  } catch {
    internalFormError.value = 'Could not load this internal form — check the link or run a metadata sync.'
  } finally {
    internalFormLoading.value = false
  }
}, { immediate: true })

function internalMapping(formFieldId: string): InternalFieldMapping {
  const mapping = state.scoring.internalForm.fields[formFieldId] as InternalFieldMapping | undefined
  return mapping && typeof mapping === 'object' ? mapping : { source: '', field: '' }
}

function setInternalMapping(formFieldId: string, patch: Partial<InternalFieldMapping>) {
  const current = internalMapping(formFieldId)
  const next = { ...current, ...patch }
  const fields = { ...state.scoring.internalForm.fields }
  if (!next.source) {
    const remaining: Record<string, InternalFieldMapping> = {}
    for (const [key, value] of Object.entries(fields)) {
      if (key !== formFieldId) remaining[key] = value as InternalFieldMapping
    }
    state.scoring.internalForm.fields = remaining
    return
  }
  fields[formFieldId] = next
  state.scoring.internalForm.fields = fields
}

function internalDefaultValue(mapping: InternalFieldMapping): string | number | undefined {
  const value = mapping.default
  if (typeof value === 'string' || typeof value === 'number') return value
  return value == null ? undefined : String(value)
}

function sourceFieldItems(source: string) {
  return (MAPPING_SOURCE_FIELDS[source] || []).map(field => ({ label: field, value: field }))
}

function addRound() {
  const order = state.rounds.length + 1
  state.rounds.push({ key: `round-${order}`, name: `Round ${order}`, order, startDate: '', endDate: '', active: true })
}

function removeRound(index: number) {
  state.rounds.splice(index, 1)
  state.rounds.forEach((round, roundIndex) => {
    round.order = roundIndex + 1
  })
}

async function saveApplicationMetadata() {
  if (!application.value) return
  loading.value = true
  try {
    await flushDraftSaves()
    await apiRequest(`/api/applications/${application.value._id}`, {
      method: 'PUT',
      body: { name: state.name, type: state.type, active: state.active, rounds: state.rounds, projectId: application.value.projectId, initialFormId: application.value.initialFormId, scoring: state.scoring, placementPathway: state.placementPathway === 'none' ? null : state.placementPathway, stages: state.stages }
    })
    toast.add({ title: 'Application settings saved', color: 'success' })
  } catch (error: unknown) {
    const message = (error as { data?: { statusMessage?: string } }).data?.statusMessage || 'Failed to save application settings'
    toast.add({ title: message, color: 'error' })
  } finally {
    loading.value = false
  }
}

async function applyTemplate() {
  if (!selectedTemplate.value || !application.value) return
  const template = templates.value?.find(item => item.key === selectedTemplate.value)
  if (!template || !confirm(`Apply ${template.name} to the routing draft?`)) return
  loading.value = true
  try {
    await flushDraftSaves()
    const result = await $fetch<{ warnings: string[], template: { name: string, draft: boolean }, stages: ReviewStage[] }>(`/api/applications/${application.value._id}/template`, { method: 'POST', body: { templateKey: selectedTemplate.value } })
    state.stages = result.stages.map(stage => ({ ...stage, routingDraft: stage.routingDraft || stage.routing }))
    templateWarnings.value = result.warnings
    toast.add({ title: `${result.template.name} applied to draft`, description: result.warnings.length ? `${result.warnings.length} references need review` : undefined, color: result.warnings.length ? 'warning' : 'success' })
  } catch (error: unknown) {
    const message = (error as { data?: { statusMessage?: string } }).data?.statusMessage || 'Failed to apply routing template'
    toast.add({ title: message, color: 'error' })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UContainer class="py-8">
    <UButton
      label="Back to applications"
      color="neutral"
      variant="ghost"
      icon="i-lucide-arrow-left"
      class="mb-2"
      @click="router.push('/applications')"
    />
    <PageHeader
      :title="state.name || 'Application configuration'"
      help="applicationDetail"
      class="mb-6"
    >
      <p class="text-muted">
        Configure routing drafts for this application. Draft changes do not execute routing.
      </p>
      <template #actions>
        <UBadge
          :label="draftState === 'saving' ? 'Saving draft…' : draftState === 'error' ? 'Draft save failed' : 'Draft saved'"
          :color="draftState === 'error' ? 'error' : 'neutral'"
          variant="subtle"
        />
        <UButton
          label="Save settings"
          :loading="loading"
          color="neutral"
          variant="outline"
          @click="saveApplicationMetadata"
        />
        <UButton
          label="Discard draft"
          color="neutral"
          variant="outline"
          @click="discardDraft"
        />
        <UButton
          label="Publish config"
          :loading="publishing"
          @click="publishDraft"
        />
      </template>
    </PageHeader>

    <div
      v-if="status === 'pending'"
      class="text-muted"
    >
      Loading application…
    </div>
    <div v-else>
      <UTabs
        v-model="activeTab"
        :items="tabItems"
        :content="false"
        class="mb-6"
      />
      <div
        v-if="activeTab === 'general'"
        class="max-w-xl space-y-5 rounded-lg border p-4"
      >
        <UFormField label="Name">
          <UInput
            v-model="state.name"
            class="w-full"
          />
        </UFormField>
        <UFormField label="Type">
          <UInput
            v-model="state.type"
            class="w-full"
          />
        </UFormField>
        <UCheckbox
          v-model="state.active"
          label="Active"
        />
      </div>
      <div
        v-else-if="activeTab === 'rounds'"
        class="space-y-4"
      >
        <div class="space-y-5 rounded-lg border p-4">
          <div class="flex items-center justify-between">
            <div>
              <h2 class="font-medium">
                Admission rounds
              </h2>
              <p class="text-sm text-muted">
                Inclusive date ranges determine this application's routing round from submission date.
              </p>
            </div>
            <UButton
              label="Add round"
              color="neutral"
              variant="outline"
              @click="addRound"
            />
          </div>
          <div
            v-if="!state.rounds.length"
            class="text-sm text-muted"
          >
            No rounds configured.
          </div>
          <div
            v-for="(round, index) in state.rounds"
            :key="index"
            class="grid grid-cols-1 gap-4 border-t pt-4 sm:grid-cols-2"
          >
            <UFormField
              label="Key"
              class="min-w-0"
            >
              <UInput
                v-model="round.key"
                placeholder="round-1"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Name"
              class="min-w-0"
            >
              <UInput
                v-model="round.name"
                placeholder="Round 1"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Start"
              class="min-w-0"
            >
              <UInput
                v-model="round.startDate"
                type="date"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="End"
              class="min-w-0"
            >
              <UInput
                v-model="round.endDate"
                type="date"
                class="w-full"
              />
            </UFormField>
            <div class="col-span-full flex items-center justify-end gap-2">
              <UCheckbox
                v-model="round.active"
                label="Active"
              />
              <UButton
                icon="i-lucide-trash-2"
                color="error"
                variant="ghost"
                aria-label="Remove round"
                @click="removeRound(index)"
              />
            </div>
          </div>
        </div>
      </div>
      <div
        v-else-if="activeTab === 'scoring'"
        class="space-y-4"
      >
        <div class="space-y-5 rounded-lg border p-4">
          <div class="flex items-center justify-between">
            <div>
              <h2 class="font-medium">
                Scoring
              </h2>
              <p class="text-sm text-muted">
                Configure the score compilation recipe and internal form write-back for this application.
              </p>
            </div>
            <UCheckbox
              v-model="state.scoring.enabled"
              label="Enabled"
            />
          </div>
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <UFormField label="Components">
              <USelectMenu
                v-model="state.scoring.components"
                :items="componentItems"
                value-key="value"
                multiple
                class="w-full"
              />
            </UFormField>
            <UFormField label="Placement pathway">
              <USelect
                v-model="state.placementPathway"
                :items="pathwayItems"
                value-key="value"
                class="w-full"
              />
            </UFormField>
            <UFormField label="GPA bonus points">
              <UInput
                v-model.number="state.scoring.gpaBonusPoints"
                type="number"
                class="w-full"
              />
            </UFormField>
            <UFormField label="DPSCD bonus points">
              <UInput
                v-model.number="state.scoring.dpscdBonusPoints"
                type="number"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Marygrove bonus — Primary">
              <UInput
                v-model.number="state.scoring.marygroveBonuses.primary"
                type="number"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Marygrove bonus — Secondary">
              <UInput
                v-model.number="state.scoring.marygroveBonuses.secondary"
                type="number"
                class="w-full"
              />
            </UFormField>
          </div>
          <UCheckbox
            v-model="state.scoring.requireComplete"
            label="Require HSPT + GPA + Essay before computing totals"
          />
          <div class="border-t pt-4 space-y-3">
            <div class="flex items-center justify-between gap-3">
              <div>
                <div class="text-sm font-medium">
                  Linked internal form
                </div>
                <div class="text-sm text-muted">
                  {{ internalFormName || (state.scoring.internalForm.formId ? state.scoring.internalForm.formId : 'None — set by metadata sync from the project') }}
                </div>
              </div>
            </div>
            <p
              v-if="internalFormLoading"
              class="text-sm text-muted"
            >
              Loading internal form fields…
            </p>
            <UAlert
              v-else-if="internalFormError"
              :description="internalFormError"
              color="error"
              variant="soft"
            />
            <p
              v-else-if="!internalFormFields.length"
              class="text-sm text-muted"
            >
              No writable fields found on the linked internal form. Run a metadata sync if the form was just added.
            </p>
            <div
              v-for="field in internalFormFields"
              :key="field.formFieldId"
              class="border-t pt-3 space-y-2"
            >
              <div class="min-w-0">
                <div class="text-sm truncate font-medium">
                  {{ field.label || field.formFieldId }}
                </div>
                <div class="text-xs text-muted">
                  {{ field.fieldType }}
                </div>
              </div>
              <div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <UFormField label="Source">
                  <USelect
                    :model-value="internalMapping(field.formFieldId).source || 'unmapped'"
                    :items="MAPPING_SOURCES"
                    value-key="value"
                    placeholder="Unmapped"
                    class="w-full"
                    @update:model-value="setInternalMapping(field.formFieldId, { source: String($event ?? '') === 'unmapped' ? '' : String($event ?? ''), field: '' })"
                  />
                </UFormField>
                <UFormField label="Data">
                  <UInput
                    v-if="internalMapping(field.formFieldId).source === 'literal'"
                    :model-value="internalMapping(field.formFieldId).field"
                    placeholder="e.g. API updated on {date} or {lnnp} | {lnlp}"
                    class="w-full"
                    @update:model-value="setInternalMapping(field.formFieldId, { field: String($event ?? '') })"
                  />
                  <USelectMenu
                    v-else
                    :model-value="internalMapping(field.formFieldId).field"
                    :items="sourceFieldItems(internalMapping(field.formFieldId).source)"
                    value-key="value"
                    :disabled="!internalMapping(field.formFieldId).source || internalMapping(field.formFieldId).source === 'placement'"
                    :placeholder="internalMapping(field.formFieldId).source === 'placement' ? 'Not available yet' : 'Field'"
                    class="w-full"
                    @update:model-value="setInternalMapping(field.formFieldId, { field: String($event ?? '') })"
                  />
                </UFormField>
                <UFormField label="Default">
                  <USelect
                    v-if="field.fieldType === 'single_response' || field.fieldType === 'multiple_response'"
                    :model-value="String(internalMapping(field.formFieldId).default ?? 'none')"
                    :items="[{ label: '— None —', value: 'none' }, ...(field.options || []).map(o => ({ label: o.label, value: o.label }))]"
                    value-key="value"
                    class="w-full"
                    @update:model-value="setInternalMapping(field.formFieldId, { default: String($event ?? '') === 'none' ? undefined : $event })"
                  />
                  <UCheckbox
                    v-else-if="field.fieldType === 'single_checkbox'"
                    :model-value="Boolean(internalMapping(field.formFieldId).default)"
                    label="Default checked"
                    @update:model-value="setInternalMapping(field.formFieldId, { default: $event })"
                  />
                  <UInput
                    v-else
                    :model-value="internalDefaultValue(internalMapping(field.formFieldId))"
                    :type="field.fieldType === 'number' ? 'number' : 'text'"
                    placeholder="Default value"
                    class="w-full"
                    @update:model-value="setInternalMapping(field.formFieldId, { default: $event === '' ? undefined : (field.fieldType === 'number' ? Number($event) : $event) })"
                  />
                </UFormField>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div
        v-else
        class="grid grid-cols-1 lg:grid-cols-2 gap-6"
      >
        <section class="space-y-4">
          <div class="flex items-end gap-3">
            <UFormField
              label="Built-in template"
              class="flex-1 max-w-md"
            >
              <USelect
                v-model="selectedTemplate"
                :items="(templates || []).map(t => ({ label: `${t.name}${t.draft ? ' (draft)' : ''}`, value: t.key }))"
                placeholder="Select a template"
              />
            </UFormField>
            <UButton
              label="Apply to draft"
              color="neutral"
              variant="outline"
              :disabled="!selectedTemplate"
              :loading="loading"
              @click="applyTemplate"
            />
          </div>
          <UAlert
            v-if="templateWarnings.length"
            title="Template warnings"
            color="warning"
            variant="subtle"
          >
            <template #description>
              <ul class="list-disc ps-5">
                <li
                  v-for="warning in templateWarnings"
                  :key="warning"
                >
                  {{ warning }}
                </li>
              </ul>
            </template>
          </UAlert>
          <UTable
            :data="state.stages"
            :columns="stageColumns"
            class="border rounded-lg"
          >
            <template #order-cell="{ row }">
              <UInput
                v-model.number="row.original.order"
                type="number"
                class="w-20"
              />
            </template>
            <template #role-cell="{ row }">
              <USelect
                v-model="row.original.role"
                :items="roleItems"
                class="w-32"
              />
            </template>
            <template #routing-cell="{ row }">
              <UButton
                size="xs"
                :label="selectedStage?.stageId === row.original.stageId ? 'Editing' : row.original.routingDraft?.enabled ? 'Configured' : 'Configure'"
                :color="selectedStage?.stageId === row.original.stageId ? 'primary' : 'neutral'"
                variant="soft"
                @click="selectStage(row.index)"
              />
            </template>
          </UTable>
        </section>

        <aside>
          <UCard class="sticky top-4">
            <template #header>
              <div class="flex flex-wrap items-center justify-between gap-2">
                <h2 class="font-semibold">
                  {{ selectedStage?.name || 'Select a stage' }}
                </h2>
                <UButton
                  v-if="selectedStage && state.stages.length > 1"
                  label="Copy from stage"
                  icon="i-lucide-copy"
                  size="xs"
                  color="neutral"
                  variant="outline"
                  @click="openCopy"
                />
              </div>
            </template>
            <RoutingConfigEditor
              v-if="selectedStage"
              :model-value="selectedStage.routingDraft || emptyRouting()"
              :references="references || { stages: [], fields: [], rounds: [], labels: [], users: [], reviewFields: [] }"
              @update:model-value="updateDraft"
            />
            <p
              v-else
              class="text-sm text-muted"
            >
              Select a stage in the table to edit its routing configuration.
            </p>
          </UCard>
        </aside>
      </div>
    </div>
    <UModal
      v-model:open="copyOpen"
      title="Copy routing configuration"
      :description="`Copy a routing config or section into ${copyTarget?.name || 'this stage'}’s draft.`"
    >
      <template #body>
        <div class="space-y-4">
          <UFormField label="Copy from">
            <USelectMenu
              v-model="copySourceId"
              :items="copySourceItems"
              value-key="value"
              placeholder="Select a stage"
              class="w-full"
            />
          </UFormField>
          <UFormField label="What to copy">
            <USelect
              v-model="copyScope"
              :items="copyScopes"
              class="w-full"
            />
          </UFormField>
          <p class="text-sm text-muted">
            This replaces {{ copyScope === 'all' ? 'the entire routing config' : copyScopes.find(item => item.value === copyScope)?.label }} in {{ copyTarget?.name }}’s draft. Full copies keep the destination’s Routing enabled setting. References to the source stage’s own reviews are updated; other stage references and outcome destinations remain unchanged.
          </p>
          <UAlert
            v-if="copyWarnings.length"
            title="Review fields not mapped on the destination form"
            :description="copyWarnings.join(', ')"
            color="warning"
            variant="soft"
          />
        </div>
      </template>
      <template #footer="{ close }">
        <UButton
          label="Cancel"
          color="neutral"
          variant="outline"
          @click="close"
        />
        <UButton
          label="Copy into draft"
          :disabled="!copySource || !copyTarget || !references"
          @click="applyCopy"
        />
      </template>
    </UModal>
  </UContainer>
</template>
