<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SelectItem } from '@nuxt/ui'
import ActionListEditor from './ActionListEditor.vue'
import ConditionGroupEditor from './ConditionGroupEditor.vue'
import OutcomeRulesEditor from './OutcomeRulesEditor.vue'
import ReferenceSelect from './ReferenceSelect.vue'
import StatusRulesEditor from './StatusRulesEditor.vue'

const props = defineProps<{
  modelValue: any
  references: { stages: SelectItem[], fields: SelectItem[], rounds: SelectItem[], labels: SelectItem[], users: SelectItem[] }
}>()
const emit = defineEmits<{ 'update:modelValue': [value: any] }>()
const config = computed(() => props.modelValue || { enabled: false, statusRules: [], outcomeRules: [], entryActions: [], exitActions: [] })
const statusItems = computed(() => Object.entries(config.value.statusLabels || {}).map(([status, labelId]) => ({ status, labelId })))
function update(patch: Record<string, unknown>) {
  emit('update:modelValue', { ...config.value, ...patch })
}
function addStatusLabel() {
  update({ statusLabels: { ...(config.value.statusLabels || {}), 'New status': '' } })
}
function updateStatusLabel(status: string, labelId: string, oldStatus: string) {
  const labels = Object.fromEntries(Object.entries(config.value.statusLabels || {}).filter(([key]) => key !== oldStatus || oldStatus === status))
  labels[status] = labelId
  update({ statusLabels: labels })
}
function removeStatusLabel(status: string) {
  const labels = Object.fromEntries(Object.entries(config.value.statusLabels || {}).filter(([key]) => key !== status))
  update({ statusLabels: labels })
}
</script>

<template>
  <div class="space-y-3">
    <div class="rounded-lg border p-3 flex items-center justify-between">
      <div>
        <p class="font-medium">
          Routing enabled
        </p>
        <p class="text-sm text-muted">
          Draft configuration can be edited and published separately from execution.
        </p>
      </div>
      <UCheckbox
        :model-value="config.enabled"
        @update:model-value="value => update({ enabled: Boolean(value) })"
      />
    </div>

    <details
      open
      class="rounded-lg border p-4"
    >
      <summary class="cursor-pointer font-medium">
        Required When
      </summary>
      <div class="pt-4">
        <ConditionGroupEditor
          :model-value="config.requiredWhen || { all: [] }"
          :references="references"
          title="Stage is required when"
          @update:model-value="update({ requiredWhen: $event })"
        />
      </div>
    </details>

    <details class="rounded-lg border p-4">
      <summary class="cursor-pointer font-medium">
        Status Rules
      </summary>
      <div class="pt-4">
        <StatusRulesEditor
          :model-value="config.statusRules || []"
          :references="references"
          :allowed-statuses="config.allowedStatuses"
          @update:model-value="update({ statusRules: $event })"
        />
      </div>
    </details>

    <details class="rounded-lg border p-4">
      <summary class="cursor-pointer font-medium">
        Status Labels
      </summary>
      <div class="pt-4 space-y-2">
        <p
          v-if="!statusItems.length"
          class="text-sm text-muted"
        >
          No status-label mappings configured.
        </p>
        <div
          v-for="item in statusItems"
          :key="item.status"
          class="grid grid-cols-[1fr_1fr_auto] gap-2 items-center"
        >
          <UInput
            :model-value="item.status"
            placeholder="Status"
            @update:model-value="(value: unknown) => updateStatusLabel(String(value), String(item.labelId), item.status)"
          />
          <ReferenceSelect
            :model-value="item.labelId"
            :items="references.labels"
            placeholder="Label"
            @update:model-value="(value: unknown) => updateStatusLabel(item.status, String(value), item.status)"
          />
          <UButton
            icon="i-lucide-trash-2"
            size="xs"
            color="error"
            variant="ghost"
            aria-label="Remove status label"
            @click="removeStatusLabel(item.status)"
          />
        </div>
        <UButton
          size="sm"
          label="Add status label"
          color="neutral"
          variant="outline"
          @click="addStatusLabel"
        />
      </div>
    </details>

    <details class="rounded-lg border p-4">
      <summary class="cursor-pointer font-medium">
        Outcome Rules
      </summary>
      <div class="pt-4">
        <OutcomeRulesEditor
          :model-value="config.outcomeRules || []"
          :references="references"
          @update:model-value="update({ outcomeRules: $event })"
        />
      </div>
    </details>

    <details class="rounded-lg border p-4">
      <summary class="cursor-pointer font-medium">
        Entry Actions
      </summary>
      <div class="pt-4">
        <ActionListEditor
          :model-value="config.entryActions || []"
          :references="references"
          title="entry"
          @update:model-value="update({ entryActions: $event })"
        />
      </div>
    </details>

    <details class="rounded-lg border p-4">
      <summary class="cursor-pointer font-medium">
        Exit Actions
      </summary>
      <div class="pt-4">
        <ActionListEditor
          :model-value="config.exitActions || []"
          :references="references"
          title="exit"
          @update:model-value="update({ exitActions: $event })"
        />
      </div>
    </details>
  </div>
</template>
