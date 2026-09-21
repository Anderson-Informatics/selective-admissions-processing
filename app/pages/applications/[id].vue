<script setup lang="ts">
import type { SelectItem, TableColumn } from '@nuxt/ui'
import RoutingConfigEditor from '../../components/routing/RoutingConfigEditor.vue'

interface RoutingConfig {
  enabled: boolean
  requiredWhen?: Record<string, unknown>
  allowedStatuses?: string[]
  statusRules: unknown[]
  statusLabels?: Record<string, string>
  outcomeRules: unknown[]
  entryActions: unknown[]
  exitActions: unknown[]
}
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
interface Application { _id: string, cycleId: string, name: string, type: string, projectId: string, initialFormId?: string, active: boolean, stages: ReviewStage[] }
interface Template { key: string, name: string, description?: string, draft?: boolean }
interface References { stages: SelectItem[], fields: SelectItem[], rounds: SelectItem[], labels: SelectItem[], users: SelectItem[] }

const route = useRoute()
const router = useRouter()
const toast = useToast()
const apiRequest = $fetch as unknown as (url: string, options: { method: 'PUT', body?: unknown }) => Promise<unknown>
const loading = ref(false)
const publishing = ref(false)
const selectedStageIndex = ref<number | null>(null)
const selectedTemplate = ref('')
const templateWarnings = ref<string[]>([])
const draftState = ref<'saved' | 'saving' | 'error'>('saved')
let autosaveTimer: ReturnType<typeof setTimeout> | null = null

const emptyRouting = (): RoutingConfig => ({ enabled: false, statusRules: [], outcomeRules: [], entryActions: [], exitActions: [] })
const { data: application, status, refresh } = await useFetch<Application>(`/api/applications/${route.params.id}`)
const { data: templates } = await useFetch<Template[]>('/api/applications/templates')
const { data: references } = await useFetch<References>(`/api/applications/${route.params.id}/routing-references`)
const state = reactive({ name: '', type: 'exam', active: true, stages: [] as ReviewStage[] })
const selectedStage = computed(() => selectedStageIndex.value == null ? undefined : state.stages[selectedStageIndex.value])
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

watchEffect(() => {
  if (!application.value || state.stages.length) return
  state.name = application.value.name
  state.type = application.value.type
  state.active = application.value.active
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

function scheduleDraftSave() {
  if (selectedStageIndex.value == null) return
  if (autosaveTimer) clearTimeout(autosaveTimer)
  draftState.value = 'saving'
  autosaveTimer = setTimeout(async () => {
    const stage = selectedStage.value
    if (!stage) return
    try {
      await $fetch(`/api/applications/${application.value?._id}/stages/${stage.stageId}`, {
        method: 'PATCH',
        body: { routing: stage.routingDraft || emptyRouting() }
      })
      draftState.value = 'saved'
    } catch {
      draftState.value = 'error'
    }
  }, 500)
}

function updateDraft(value: RoutingConfig) {
  const stage = selectedStage.value
  if (!stage) return
  stage.routingDraft = value
  scheduleDraftSave()
}

async function publishDraft() {
  if (!application.value) return
  publishing.value = true
  try {
    const result = await $fetch<{ stages: ReviewStage[] }>(`/api/applications/${application.value._id}/routing-publish`, { method: 'POST' })
    state.stages = result.stages.map(stage => ({ ...stage, routingDraft: stage.routingDraft || stage.routing }))
    toast.add({ title: 'Routing configuration published', color: 'success' })
  } catch (error: unknown) {
    const message = (error as { data?: { statusMessage?: string } }).data?.statusMessage || 'Failed to publish routing configuration'
    toast.add({ title: message, color: 'error' })
  } finally {
    publishing.value = false
  }
}

async function discardDraft() {
  if (!application.value || !confirm('Discard all routing draft changes?')) return
  await $fetch(`/api/applications/${application.value._id}/routing-discard`, { method: 'POST' })
  await refresh()
  state.stages = (application.value?.stages || []).map(stage => ({ ...stage, routingDraft: stage.routingDraft || stage.routing }))
  toast.add({ title: 'Routing draft discarded', color: 'success' })
}

async function saveApplicationMetadata() {
  if (!application.value) return
  loading.value = true
  try {
    await apiRequest(`/api/applications/${application.value._id}`, {
      method: 'PUT',
      body: { name: state.name, type: state.type, active: state.active, projectId: application.value.projectId, initialFormId: application.value.initialFormId, stages: state.stages }
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
  <UContainer class="py-8 max-w-[1600px]">
    <div class="flex items-center justify-between gap-4 mb-6">
      <div>
        <UButton
          label="Back to applications"
          color="neutral"
          variant="ghost"
          icon="i-lucide-arrow-left"
          @click="router.push('/applications')"
        />
        <h1 class="text-2xl font-semibold mt-2">
          {{ state.name || 'Application configuration' }}
        </h1>
        <p class="text-muted">
          Configure routing drafts for this application. Draft changes do not execute routing.
        </p>
      </div>
      <div class="flex gap-2 items-center">
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
          label="Publish routing"
          :loading="publishing"
          @click="publishDraft"
        />
      </div>
    </div>

    <div
      v-if="status === 'pending'"
      class="text-muted"
    >
      Loading application…
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
            <h2 class="font-semibold">
              {{ selectedStage?.name || 'Select a stage' }}
            </h2>
          </template>
          <RoutingConfigEditor
            v-if="selectedStage"
            :model-value="selectedStage.routingDraft || emptyRouting()"
            :references="references || { stages: [], fields: [], rounds: [], labels: [], users: [] }"
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
  </UContainer>
</template>
