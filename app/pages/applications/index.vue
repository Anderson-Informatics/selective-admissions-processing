<script setup lang="ts">
import type { TableColumn, SelectItem } from '@nuxt/ui'

interface Cycle {
  _id: string
  year: string
  name: string
  active: boolean
}

interface SubmittableStage {
  reviewStageId: string
  stageName: string
  type: string
  formId?: string
  stageOrder?: number
}

interface SubmittableProject {
  projectId: string
  name: string
  initialFormId?: string
  reviewStages: SubmittableStage[]
}

interface ReviewStage {
  _id: string
  stageId: string
  name: string
  type: string
  formId?: string
  order: number
  role: 'initial' | 'work' | 'hold' | 'final'
  routing: RoutingConfig
}

interface RoutingConfig {
  enabled: boolean
  requiredWhen?: ConditionGroup
  allowedStatuses?: string[]
  statusRules: unknown[]
  statusLabels?: Record<string, string>
  outcomeRules: unknown[]
  entryActions: unknown[]
  exitActions: unknown[]
}

interface ConditionGroup {
  all: unknown[]
  any?: unknown[]
}

interface Application {
  _id: string
  cycleId: string
  name: string
  type: string
  projectId: string
  initialFormId?: string
  active: boolean
  stages: ReviewStage[]
}

const toast = useToast()
const apiRequest = $fetch as unknown as (url: string, options: { method: 'PUT' | 'DELETE', body?: unknown }) => Promise<unknown>
const emptyRouting = (): RoutingConfig => ({
  enabled: false,
  statusRules: [],
  outcomeRules: [],
  entryActions: [],
  exitActions: []
})

const { data: templates } = await useFetch<{ key: string, name: string, description?: string, draft?: boolean, config: Record<string, unknown> }[]>('/api/applications/templates')
const templateWarnings = ref<string[]>([])
const selectedStageIndex = ref<number | null>(null)
const routingJson = ref('')
const routingError = ref('')
const selectedTemplate = ref('')

const { data: cycles } = await useFetch<Cycle[]>('/api/cycles')
const { data: projects } = await useFetch<SubmittableProject[]>('/api/submittable/projects')

const selectedCycleId = ref('')

const cycleItems = computed<SelectItem[]>(() =>
  (cycles.value || []).map(c => ({ label: `${c.year} — ${c.name}`, value: c._id }))
)

watchEffect(() => {
  const active = cycles.value?.find(c => c.active)
  if (active && !selectedCycleId.value) {
    selectedCycleId.value = active._id
  }
})

const applicationsUrl = computed(() =>
  selectedCycleId.value ? `/api/applications?cycleId=${selectedCycleId.value}` : '/api/applications?cycleId=none'
)
const { data: applications, refresh: refreshApplications, status: applicationsStatus } = useFetch<Application[]>(applicationsUrl)

const applicationByProjectId = computed(() => {
  const map: Record<string, Application> = {}
  for (const application of applications.value || []) {
    map[application.projectId] = application
  }
  return map
})

const projectById = computed(() => {
  const map: Record<string, SubmittableProject> = {}
  for (const project of projects.value || []) {
    map[project.projectId] = project
  }
  return map
})

const columns: TableColumn<Application>[] = [
  { accessorKey: 'name', header: 'Application name' },
  { id: 'project', accessorFn: (row: Application) => projectById.value[row.projectId]?.name || row.projectId, header: 'Project' },
  { accessorKey: 'type', header: 'Type' },
  { id: 'active', accessorKey: 'active', header: 'Active' },
  { id: 'actions', header: 'Actions', enableSorting: false }
]

const modalOpen = ref(false)
const editingApplicationId = ref<string | null>(null)
const selectedProjectId = ref('')
const loading = ref(false)

const state = reactive({
  name: '',
  type: 'exam',
  active: true,
  stages: [] as {
    stageId: string
    name: string
    type: string
    formId?: string
    order: number
    role: 'initial' | 'work' | 'hold' | 'final'
    routing: RoutingConfig
  }[]
})

const selectedStage = computed(() => selectedStageIndex.value == null ? undefined : state.stages[selectedStageIndex.value])

const typeItems: SelectItem[] = [
  { label: 'Exam', value: 'exam' },
  { label: 'Application', value: 'application' },
  { label: 'DSA', value: 'dsa' }
]

const unmappedProjectItems = computed<SelectItem[]>(() =>
  (projects.value || [])
    .filter((p) => {
      const application = applicationByProjectId.value[p.projectId]
      return !application || application._id === editingApplicationId.value
    })
    .map(p => ({ label: p.name, value: p.projectId }))
)

function resetState() {
  state.name = ''
  state.type = 'exam'
  state.active = true
  state.stages = []
  selectedProjectId.value = ''
  editingApplicationId.value = null
  selectedStageIndex.value = null
  routingJson.value = ''
  routingError.value = ''
  selectedTemplate.value = ''
  templateWarnings.value = []
}

function openMap(project: SubmittableProject) {
  resetState()
  editingApplicationId.value = null
  selectedProjectId.value = project.projectId
  applyProjectStages(project)
  modalOpen.value = true
}

function openEdit(application: Application) {
  void navigateTo(`/applications/${application._id}`)
}

function openRoutingEditor(index: number) {
  selectedStageIndex.value = index
  routingJson.value = JSON.stringify(state.stages[index]?.routing || emptyRouting(), null, 2)
  routingError.value = ''
}

function closeRoutingEditor() {
  selectedStageIndex.value = null
  routingError.value = ''
}

function applyRoutingJson() {
  if (selectedStageIndex.value == null) return
  try {
    const parsed = JSON.parse(routingJson.value)
    if (!parsed || typeof parsed !== 'object' || typeof parsed.enabled !== 'boolean') {
      throw new Error('Routing config must be an object with an enabled boolean')
    }
    const stage = state.stages[selectedStageIndex.value]
    if (!stage) throw new Error('Selected stage is unavailable')
    stage.routing = {
      ...emptyRouting(),
      ...parsed,
      statusRules: Array.isArray(parsed.statusRules) ? parsed.statusRules : [],
      outcomeRules: Array.isArray(parsed.outcomeRules) ? parsed.outcomeRules : [],
      entryActions: Array.isArray(parsed.entryActions) ? parsed.entryActions : [],
      exitActions: Array.isArray(parsed.exitActions) ? parsed.exitActions : []
    }
    routingError.value = ''
    toast.add({ title: 'Routing configuration applied', color: 'success' })
  } catch (error: unknown) {
    routingError.value = error instanceof Error ? error.message : 'Invalid JSON'
  }
}

function copyRoutingFrom(index: number) {
  if (selectedStageIndex.value == null) return
  const source = state.stages[index]
  const target = state.stages[selectedStageIndex.value]
  if (!source || !target) return
  target.routing = JSON.parse(JSON.stringify(source.routing))
  routingJson.value = JSON.stringify(target.routing, null, 2)
  selectedTemplate.value = ''
}

function resolveTemplateReferences(value: unknown, stageByName: Map<string, string>, warnings: string[], path = ''): unknown {
  if (Array.isArray(value)) return value.map((item, index) => resolveTemplateReferences(item, stageByName, warnings, `${path}[${index}]`))
  if (!value || typeof value !== 'object') return value

  const source = value as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(source)) {
    if (key === 'stageName' || key === 'targetStageName') {
      if (typeof child !== 'string') continue
      const stageId = stageByName.get(child)
      if (!stageId) {
        warnings.push(`${path || 'routing'} references missing stage "${child}"`)
        continue
      }
      result[key === 'targetStageName' ? 'moveToStageId' : 'stageId'] = stageId
      continue
    }
    if (key === 'stageNames') {
      const names = Array.isArray(child) ? child : []
      const stageIds = names.flatMap((name) => {
        const stageId = typeof name === 'string' ? stageByName.get(name) : undefined
        if (!stageId && typeof name === 'string') warnings.push(`${path || 'routing'} references missing stage "${name}"`)
        return stageId ? [stageId] : []
      })
      result.stageIds = stageIds
      continue
    }
    result[key] = resolveTemplateReferences(child, stageByName, warnings, `${path}.${key}`)
  }
  return result
}

async function applyTemplate() {
  if (!selectedTemplate.value) return
  const template = templates.value?.find(item => item.key === selectedTemplate.value)
  if (!template) return
  if (!confirm(`Apply ${template.name}? This replaces the routing configuration for all stages.`)) return

  if (editingApplicationId.value) {
    loading.value = true
    try {
      const result = await $fetch<{ warnings: string[], template: { name: string, draft: boolean } }>(`/api/applications/${editingApplicationId.value}/template`, {
        method: 'POST',
        body: { templateKey: selectedTemplate.value }
      })
      templateWarnings.value = result.warnings
      await refreshApplications()
      modalOpen.value = false
      toast.add({
        title: result.template.draft ? `${result.template.name} applied as draft` : `${result.template.name} applied and saved`,
        description: result.warnings.length ? `${result.warnings.length} stage references need review` : undefined,
        color: result.warnings.length ? 'warning' : 'success'
      })
    } catch (error: unknown) {
      const message = (error as { data?: { statusMessage?: string } }).data?.statusMessage || 'Failed to apply routing template'
      toast.add({ title: message, color: 'error' })
    } finally {
      loading.value = false
    }
    return
  }

  const stageByName = new Map(state.stages.map(stage => [stage.name, stage.stageId]))
  const warnings: string[] = []
  const templateStages = (template.config.stages || {}) as Record<string, { role?: 'initial' | 'work' | 'hold' | 'final', routing?: unknown }>
  state.stages.forEach((stage, index) => {
    const configured = templateStages[stage.name]
    stage.role = configured?.role || (index === 0 ? 'initial' : /accepted|declined|achiever/i.test(stage.name) ? 'final' : /pending|no exam/i.test(stage.name) ? 'hold' : 'work')
    const resolved = configured?.routing ? resolveTemplateReferences(configured.routing, stageByName, warnings, stage.name) : emptyRouting()
    stage.routing = template.draft && resolved && typeof resolved === 'object'
      ? { ...emptyRouting(), ...(resolved as RoutingConfig), enabled: false }
      : { ...emptyRouting(), ...(resolved as RoutingConfig) }
  })
  templateWarnings.value = warnings
  if (warnings.length) toast.add({ title: `${warnings.length} template references need review`, description: warnings[0], color: 'warning' })
  else toast.add({ title: `${template.name} applied`, color: 'success' })
  if (selectedStageIndex.value != null) {
    const target = state.stages[selectedStageIndex.value]
    if (target) routingJson.value = JSON.stringify(target.routing, null, 2)
  }
}

function applyProjectStages(project: SubmittableProject) {
  state.name = project.name
  state.stages = (project.reviewStages || []).map((s, index) => ({
    stageId: s.reviewStageId,
    name: s.stageName,
    type: s.type,
    formId: s.formId,
    order: s.stageOrder ?? index,
    role: index === 0 ? 'initial' : 'work',
    routing: emptyRouting()
  }))
}

watch(selectedProjectId, (projectId) => {
  if (editingApplicationId.value) return
  const project = projects.value?.find(p => p.projectId === projectId)
  if (project) applyProjectStages(project)
})

async function onSave() {
  if (!selectedCycleId.value) return
  loading.value = true

  const project = projects.value?.find(p => p.projectId === selectedProjectId.value)
  const payload = {
    cycleId: selectedCycleId.value,
    name: state.name,
    type: state.type,
    projectId: selectedProjectId.value,
    initialFormId: project?.initialFormId,
    active: state.active,
    stages: state.stages
  }

  try {
    if (editingApplicationId.value) {
      await apiRequest(`/api/applications/${editingApplicationId.value}`, { method: 'PUT', body: payload })
      toast.add({ title: 'Application updated', color: 'success' })
    } else {
      await $fetch('/api/applications', { method: 'POST', body: payload })
      toast.add({ title: 'Application mapped', color: 'success' })
    }
    modalOpen.value = false
    await refreshApplications()
  } catch (err: unknown) {
    toast.add({
      title: (err as { data?: { statusMessage?: string } }).data?.statusMessage || 'Failed to save application mapping',
      color: 'error'
    })
  } finally {
    loading.value = false
  }
}

async function onDelete(application: Application) {
  if (!confirm(`Delete mapping for ${application.name}?`)) return
  try {
    await apiRequest(`/api/applications/${application._id}`, { method: 'DELETE' })
    toast.add({ title: 'Application mapping deleted', color: 'success' })
    await refreshApplications()
  } catch (err: unknown) {
    toast.add({
      title: (err as { data?: { statusMessage?: string } }).data?.statusMessage || 'Failed to delete application mapping',
      color: 'error'
    })
  }
}

const stageColumns: TableColumn<typeof state.stages[number]>[] = [
  { accessorKey: 'name', header: 'Stage' },
  { accessorKey: 'type', header: 'Type' },
  { id: 'order', accessorKey: 'order', header: 'Order' },
  { id: 'role', accessorKey: 'role', header: 'Role' },
  { id: 'routing', header: 'Routing', enableSorting: false }
]
</script>

<template>
  <UContainer class="py-8">
    <div class="flex justify-between items-center mb-6">
      <h1 class="text-2xl font-semibold">
        Application &amp; Review Stage Configuration
      </h1>
      <UButton
        :disabled="!selectedCycleId"
        icon="i-lucide-plus"
        label="Map project"
        @click="openMap({ projectId: '', name: '', reviewStages: [] })"
      />
    </div>

    <UFormField
      label="Admission cycle"
      class="mb-6"
    >
      <USelect
        v-model="selectedCycleId"
        :items="cycleItems"
        placeholder="Select a cycle"
        class="w-72"
      />
    </UFormField>

    <div
      v-if="applicationsStatus === 'pending'"
      class="text-muted"
    >
      Loading...
    </div>

    <UTable
      v-else
      :data="applications || []"
      :columns="columns"
    >
      <template #project-cell="{ row }">
        <span class="text-sm text-muted">
          {{ projectById[row.original.projectId]?.name || row.original.projectId }}
        </span>
      </template>

      <template #active-cell="{ row }">
        <UBadge
          :label="row.original.active ? 'Active' : 'Inactive'"
          :color="row.original.active ? 'success' : 'neutral'"
          variant="subtle"
        />
      </template>

      <template #actions-cell="{ row }">
        <div class="flex gap-1">
          <UButton
            icon="i-lucide-pencil"
            color="neutral"
            variant="ghost"
            aria-label="Edit"
            @click="openEdit(row.original)"
          />
          <UButton
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            aria-label="Delete"
            @click="onDelete(row.original)"
          />
        </div>
      </template>
    </UTable>

    <UModal
      v-model:open="modalOpen"
      title="Map application"
      description="Link a Submittable project to an application and configure its review stages."
      :ui="{ content: '!max-w-4xl' }"
    >
      <template #body>
        <form
          class="space-y-4"
          @submit.prevent="onSave"
        >
          <UFormField
            label="Submittable project"
            required
          >
            <USelect
              v-model="selectedProjectId"
              :items="unmappedProjectItems"
              placeholder="Select a project"
              :disabled="!!editingApplicationId"
              class="w-full"
            />
          </UFormField>

          <UFormField
            label="Application name"
            required
          >
            <UInput
              v-model="state.name"
              required
            />
          </UFormField>

          <UFormField label="Application type">
            <USelect
              v-model="state.type"
              :items="typeItems"
              class="w-full"
            />
          </UFormField>

          <UFormField label="Active">
            <UCheckbox
              v-model="state.active"
              label="Active for this cycle"
            />
          </UFormField>

          <div class="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-muted">
            Routing configuration is saved for later use. Saving this page does not execute routing or modify Submittable submissions.
          </div>

          <div class="flex items-end gap-3">
            <UFormField
              label="Built-in template"
              class="flex-1"
            >
              <USelect
                v-model="selectedTemplate"
                :items="(templates || []).map(t => ({ label: `${t.name}${t.draft ? ' (draft)' : ''}`, value: t.key }))"
                placeholder="Select a template"
              />
            </UFormField>
            <UButton
              label="Apply template"
              color="neutral"
              variant="outline"
              :disabled="!selectedTemplate"
              :loading="loading"
              @click="applyTemplate"
            />
          </div>

          <div
            v-if="templateWarnings.length"
            class="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm"
          >
            <p class="font-medium">
              Template warnings
            </p>
            <ul class="list-disc ps-5 mt-1">
              <li
                v-for="warning in templateWarnings"
                :key="warning"
              >
                {{ warning }}
              </li>
            </ul>
          </div>

          <div>
            <h3 class="text-sm font-medium mb-2">
              Review stages
            </h3>
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
                  :items="[
                    { label: 'Initial', value: 'initial' },
                    { label: 'Work', value: 'work' },
                    { label: 'Hold', value: 'hold' },
                    { label: 'Final', value: 'final' }
                  ]"
                  class="w-32"
                />
              </template>

              <template #routing-cell="{ row }">
                <UButton
                  size="xs"
                  :label="row.original.routing.enabled ? 'Edit rules' : 'Configure'"
                  :color="row.original.routing.enabled ? 'primary' : 'neutral'"
                  variant="soft"
                  @click="openRoutingEditor(row.index)"
                />
              </template>
            </UTable>
          </div>

          <div
            v-if="selectedStageIndex !== null"
            class="space-y-3 rounded-lg border p-4"
          >
            <div class="flex items-center justify-between">
              <div>
                <h3 class="font-medium">
                  Routing JSON: {{ selectedStage?.name }}
                </h3>
                <p class="text-sm text-muted">
                  Use stage IDs from this application. The server validates the complete schema before saving.
                </p>
              </div>
              <UButton
                label="Close editor"
                color="neutral"
                variant="ghost"
                @click="closeRoutingEditor"
              />
            </div>

            <div class="flex items-center gap-3">
              <UCheckbox
                :model-value="selectedStage?.routing.enabled || false"
                label="Enable routing for this stage"
                @update:model-value="value => { if (selectedStage) selectedStage.routing.enabled = Boolean(value) }"
              />
              <USelect
                :items="state.stages.filter((_, index) => index !== selectedStageIndex).map((stage, index) => ({ label: stage.name, value: state.stages.findIndex(item => item.stageId === stage.stageId) }))"
                placeholder="Copy from stage..."
                @update:model-value="value => value !== undefined && copyRoutingFrom(Number(value))"
              />
              <UButton
                label="Apply JSON"
                :disabled="!!routingError"
                @click="applyRoutingJson"
              />
            </div>

            <UTextarea
              v-model="routingJson"
              :rows="18"
              class="font-mono text-xs w-full"
            />
            <p
              v-if="routingError"
              class="text-sm text-error"
            >
              {{ routingError }}
            </p>
          </div>
        </form>
      </template>

      <template #footer="{ close }">
        <UButton
          color="neutral"
          variant="outline"
          label="Cancel"
          @click="close"
        />
        <UButton
          label="Save"
          :loading="loading"
          @click="onSave"
        />
      </template>
    </UModal>
  </UContainer>
</template>
