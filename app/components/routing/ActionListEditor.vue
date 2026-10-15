<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SelectItem } from '@nuxt/ui'
import ConditionGroupEditor from './ConditionGroupEditor.vue'
import ReferenceSelect from './ReferenceSelect.vue'

const props = defineProps<{ modelValue: any[], references: { stages: SelectItem[], fields: SelectItem[], rounds: SelectItem[], labels: SelectItem[], users: SelectItem[], reviewFields: Array<{ stageId: string, fields: SelectItem[] }> }, title: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: any[]] }>()
function add() {
  emit('update:modelValue', [...props.modelValue, { when: { operator: 'and', conditions: [] }, addLabelIds: [], removeLabelIds: [], assignUserIds: [], unassignUserIds: [] }])
}
function updateAction(index: number, patch: Record<string, unknown>) {
  emit('update:modelValue', props.modelValue.map((action, i) => i === index ? { ...action, ...patch } : action))
}
function remove(index: number) {
  emit('update:modelValue', props.modelValue.filter((_, itemIndex) => itemIndex !== index))
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex justify-between items-center">
      <p class="text-sm text-muted">
        Actions are stored for later execution; editing them does not call Submittable.
      </p>
      <UButton
        size="sm"
        :label="`Add ${title} action`"
        color="neutral"
        variant="outline"
        @click="add"
      />
    </div>
    <p
      v-if="!modelValue.length"
      class="text-sm text-muted"
    >
      No {{ title }} actions configured.
    </p>
    <div
      v-for="(action, index) in modelValue"
      :key="index"
      class="rounded-lg border p-3 space-y-3"
    >
      <div class="flex justify-end">
        <UButton
          icon="i-lucide-trash-2"
          size="xs"
          color="error"
          variant="ghost"
          :aria-label="`Remove ${title} action`"
          @click="remove(index)"
        />
      </div>
      <ConditionGroupEditor
        :model-value="action.when"
        :references="references"
        title="When"
        @update:model-value="updateAction(index, { when: $event })"
      />
      <ReferenceSelect
        :model-value="action.addLabelIds"
        :items="references.labels"
        multiple
        placeholder="Add labels"
        @update:model-value="updateAction(index, { addLabelIds: $event })"
      />
      <ReferenceSelect
        :model-value="action.removeLabelIds"
        :items="references.labels"
        multiple
        placeholder="Remove labels"
        @update:model-value="updateAction(index, { removeLabelIds: $event })"
      />
      <ReferenceSelect
        :model-value="action.assignUserIds"
        :items="references.users"
        multiple
        placeholder="Assign users"
        @update:model-value="updateAction(index, { assignUserIds: $event })"
      />
      <ReferenceSelect
        :model-value="action.unassignUserIds"
        :items="references.users"
        multiple
        placeholder="Unassign users"
        @update:model-value="updateAction(index, { unassignUserIds: $event })"
      />
    </div>
  </div>
</template>
