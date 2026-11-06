<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SelectItem } from '@nuxt/ui'
import ConditionGroupEditor from './ConditionGroupEditor.vue'
import ReferenceSelect from './ReferenceSelect.vue'

const props = defineProps<{ modelValue: any[], references: { stages: SelectItem[], fields: SelectItem[], rounds: SelectItem[], labels: SelectItem[], users: SelectItem[], reviewFields: Array<{ stageId: string, fields: SelectItem[] }> }, title: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: any[]] }>()

interface MessageTemplate { _id: string, name: string }
const { data: messageTemplates } = useFetch<MessageTemplate[]>('/api/templates', { default: () => [] })
const templateItems = computed<SelectItem[]>(() => (messageTemplates.value || []).map(template => ({ label: template.name, value: template._id })))

function add() {
  emit('update:modelValue', [...props.modelValue, { when: { operator: 'and', conditions: [] }, addLabelIds: [], removeLabelIds: [], assignUserIds: [], unassignUserIds: [] }])
}
function updateAction(index: number, patch: Record<string, unknown>) {
  emit('update:modelValue', props.modelValue.map((action, i) => i === index ? { ...action, ...patch } : action))
}
function remove(index: number) {
  emit('update:modelValue', props.modelValue.filter((_, itemIndex) => itemIndex !== index))
}
function setEditingAction(index: number, kind: 'openForEditing' | 'closeForEditing', enabled: boolean, current: any) {
  updateAction(index, { [kind]: enabled ? { templateId: undefined, internalNoteTemplate: '', ...(current || {}) } : undefined })
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
      <div class="border-t pt-3 space-y-3">
        <div class="flex items-center gap-3">
          <UCheckbox
            :model-value="Boolean(action.openForEditing)"
            label="Open for editing (emails the applicant)"
            @update:model-value="setEditingAction(index, 'openForEditing', $event === true, action.openForEditing)"
          />
          <template v-if="action.openForEditing">
            <USelect
              :model-value="action.openForEditing.templateId"
              :items="templateItems"
              placeholder="Message template"
              class="w-64"
              @update:model-value="updateAction(index, { openForEditing: { ...action.openForEditing, templateId: $event } })"
            />
            <UInput
              :model-value="action.openForEditing.internalNoteTemplate"
              placeholder="Internal note (optional)"
              class="flex-1"
              @update:model-value="updateAction(index, { openForEditing: { ...action.openForEditing, internalNoteTemplate: $event } })"
            />
          </template>
        </div>
        <div class="flex items-center gap-3">
          <UCheckbox
            :model-value="Boolean(action.closeForEditing)"
            label="Close for editing"
            @update:model-value="setEditingAction(index, 'closeForEditing', $event === true, action.closeForEditing)"
          />
          <template v-if="action.closeForEditing">
            <USelect
              :model-value="action.closeForEditing.templateId"
              :items="templateItems"
              placeholder="Message template (optional)"
              class="w-64"
              @update:model-value="updateAction(index, { closeForEditing: { ...action.closeForEditing, templateId: $event } })"
            />
            <UInput
              :model-value="action.closeForEditing.internalNoteTemplate"
              placeholder="Internal note (optional)"
              class="flex-1"
              @update:model-value="updateAction(index, { closeForEditing: { ...action.closeForEditing, internalNoteTemplate: $event } })"
            />
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
