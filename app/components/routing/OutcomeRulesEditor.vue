<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SelectItem } from '@nuxt/ui'
import ConditionGroupEditor from './ConditionGroupEditor.vue'
import ReferenceSelect from './ReferenceSelect.vue'

const props = defineProps<{ modelValue: any[], references: { stages: SelectItem[], fields: SelectItem[], rounds: SelectItem[], labels: SelectItem[], users: SelectItem[] } }>()
const emit = defineEmits<{ 'update:modelValue': [value: any[]] }>()
function add() {
  emit('update:modelValue', [...props.modelValue, { name: 'New outcome rule', enabled: true, when: { all: [] } }])
}
function remove(index: number) {
  emit('update:modelValue', props.modelValue.filter((_, itemIndex) => itemIndex !== index))
}
function move(index: number, direction: number) {
  const next = index + direction
  if (next < 0 || next >= props.modelValue.length) return
  const copy = [...props.modelValue]
  const [item] = copy.splice(index, 1)
  copy.splice(next, 0, item)
  emit('update:modelValue', copy)
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex justify-end">
      <UButton
        size="sm"
        label="Add outcome rule"
        color="neutral"
        variant="outline"
        @click="add"
      />
    </div>
    <p
      v-if="!modelValue.length"
      class="text-sm text-muted"
    >
      No outcome rules configured. This stage will follow ordinary required-stage routing.
    </p>
    <div
      v-for="(rule, index) in modelValue"
      :key="`${rule.name}-${index}`"
      class="rounded-lg border p-3 space-y-3"
    >
      <div class="flex items-center gap-2">
        <UInput
          v-model="rule.name"
          placeholder="Rule name"
          class="flex-1"
        />
        <UCheckbox
          v-model="rule.enabled"
          label="Enabled"
        />
        <UButton
          icon="i-lucide-chevron-up"
          size="xs"
          color="neutral"
          variant="ghost"
          :disabled="index === 0"
          @click="move(index, -1)"
        />
        <UButton
          icon="i-lucide-chevron-down"
          size="xs"
          color="neutral"
          variant="ghost"
          :disabled="index === modelValue.length - 1"
          @click="move(index, 1)"
        />
        <UButton
          icon="i-lucide-trash-2"
          size="xs"
          color="error"
          variant="ghost"
          @click="remove(index)"
        />
      </div>
      <ReferenceSelect
        v-model="rule.moveToStageId"
        :items="references.stages"
        placeholder="Target stage"
      />
      <ConditionGroupEditor
        v-model="rule.when"
        :references="references"
        title="When"
      />
    </div>
  </div>
</template>
