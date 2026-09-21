<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SelectItem } from '@nuxt/ui'
import ConditionGroupEditor from './ConditionGroupEditor.vue'

const props = defineProps<{ modelValue: any[], references: { stages: SelectItem[], fields: SelectItem[], rounds: SelectItem[], labels: SelectItem[] }, allowedStatuses?: string[] }>()
const emit = defineEmits<{ 'update:modelValue': [value: any[]] }>()
function add() {
  emit('update:modelValue', [...props.modelValue, { name: 'New status rule', status: 'Incomplete', complete: false }])
}
function remove(index: number, rules: any[]) {
  emit('update:modelValue', rules.filter((_, itemIndex) => itemIndex !== index))
}
function move(index: number, direction: number, rules: any[]) {
  const next = index + direction
  if (next < 0 || next >= rules.length) return
  const copy = [...rules]
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
        label="Add status rule"
        color="neutral"
        variant="outline"
        @click="add"
      />
    </div>
    <p
      v-if="!modelValue.length"
      class="text-sm text-muted"
    >
      No status rules configured. Add a default or conditional status rule below.
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
        <UInput
          v-model="rule.status"
          placeholder="Status text"
          class="flex-1"
        />
        <UCheckbox
          v-model="rule.complete"
          label="Complete"
        />
        <UButton
          icon="i-lucide-chevron-up"
          size="xs"
          color="neutral"
          variant="ghost"
          :disabled="index === 0"
          @click="move(index, -1, modelValue)"
        />
        <UButton
          icon="i-lucide-chevron-down"
          size="xs"
          color="neutral"
          variant="ghost"
          :disabled="index === modelValue.length - 1"
          @click="move(index, 1, modelValue)"
        />
        <UButton
          icon="i-lucide-trash-2"
          size="xs"
          color="error"
          variant="ghost"
          @click="remove(index, modelValue)"
        />
      </div>
      <ConditionGroupEditor
        v-if="rule.when"
        v-model="rule.when"
        :references="references"
        title="When"
      />
      <UButton
        v-else
        size="xs"
        label="Add condition"
        color="neutral"
        variant="soft"
        @click="rule.when = { all: [] }"
      />
    </div>
  </div>
</template>
