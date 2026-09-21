<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SelectItem } from '@nuxt/ui'
import ReferenceSelect from './ReferenceSelect.vue'

interface References {
  stages: SelectItem[]
  fields: SelectItem[]
  rounds: SelectItem[]
  labels: SelectItem[]
}

const props = defineProps<{
  modelValue: any
  references: References
  title?: string
  depth?: number
}>()
const emit = defineEmits<{ 'update:modelValue': [value: any] }>()

const conditionKinds: SelectItem[] = [
  { label: 'Submission field', value: 'field' },
  { label: 'Label', value: 'label' },
  { label: 'Cycle round', value: 'cycleRound' },
  { label: 'Review field', value: 'reviewField' },
  { label: 'Review score', value: 'reviewScore' },
  { label: 'Review count', value: 'reviewCount' },
  { label: 'Review spread', value: 'reviewSpread' },
  { label: 'GPA status', value: 'gpaStatus' },
  { label: 'HSPT linked', value: 'hsptLinked' },
  { label: 'GPA record', value: 'gpaRecord' }
]
const operators: SelectItem[] = [
  { label: 'equals', value: 'eq' },
  { label: 'not equals', value: 'ne' },
  { label: 'in', value: 'in' },
  { label: 'greater than or equal', value: 'gte' },
  { label: 'less than or equal', value: 'lte' },
  { label: 'is present', value: 'notNull' },
  { label: 'is blank', value: 'isNull' }
]

const group = computed(() => props.modelValue || { all: [] })
function update(value: any) {
  emit('update:modelValue', value)
}
function add(kind: 'all' | 'any') {
  update({ ...group.value, [kind]: [...(group.value[kind] || []), { kind: 'field', name: '', op: 'eq', value: '' }] })
}
function remove(kind: 'all' | 'any', index: number) {
  update({ ...group.value, [kind]: (group.value[kind] || []).filter((_: unknown, itemIndex: number) => itemIndex !== index) })
}
function setCondition(kind: 'all' | 'any', index: number, value: any) {
  const values = [...(group.value[kind] || [])]
  values[index] = value
  update({ ...group.value, [kind]: values })
}
function summaryCondition(condition: any) {
  if (!condition || condition.all || condition.any) return 'Nested condition group'
  return condition.kind || 'Condition'
}
</script>

<template>
  <div
    class="space-y-3 rounded-lg border p-3"
    :class="depth ? 'ms-4' : ''"
  >
    <div class="flex items-center justify-between">
      <strong class="text-sm">{{ title || 'All conditions' }}</strong>
      <div class="flex gap-1">
        <UButton
          size="xs"
          label="+ ALL"
          color="neutral"
          variant="soft"
          @click="add('all')"
        />
        <UButton
          size="xs"
          label="+ ANY"
          color="neutral"
          variant="soft"
          @click="add('any')"
        />
      </div>
    </div>

    <p
      v-if="!(group.all || []).length && !(group.any || []).length"
      class="text-sm text-muted"
    >
      No conditions configured. An empty group currently matches all submissions.
    </p>

    <div
      v-for="(condition, index) in group.all || []"
      :key="`all-${index}`"
      class="rounded border p-2 space-y-2"
    >
      <ConditionGroupEditor
        v-if="condition.all || condition.any"
        :model-value="condition"
        :references="references"
        title="Nested ALL/ANY"
        :depth="(depth || 0) + 1"
        @update:model-value="value => setCondition('all', Number(index), value)"
      />
      <div
        v-else
        class="grid grid-cols-1 md:grid-cols-4 gap-2"
      >
        <USelect
          v-model="condition.kind"
          :items="conditionKinds"
        />
        <ReferenceSelect
          v-if="condition.kind === 'label'"
          v-model="condition.labelId"
          :items="references.labels"
          placeholder="Label"
        />
        <ReferenceSelect
          v-else-if="condition.kind === 'cycleRound'"
          v-model="condition.value"
          :items="references.rounds"
          placeholder="Round"
        />
        <ReferenceSelect
          v-else-if="['reviewField', 'reviewScore', 'reviewCount', 'reviewSpread'].includes(condition.kind)"
          v-model="condition.stageId"
          :items="references.stages"
          placeholder="Review stage"
        />
        <ReferenceSelect
          v-else-if="condition.kind === 'field'"
          v-model="condition.name"
          :items="references.fields"
          placeholder="Field"
        />
        <UInput
          v-else
          v-model="condition.value"
          placeholder="Value"
        />
        <USelect
          v-model="condition.op"
          :items="operators"
        />
        <UInput
          v-if="!['isNull', 'notNull', 'hasLabel', 'lacksLabel'].includes(condition.op) && !['label', 'cycleRound'].includes(condition.kind)"
          v-model="condition.value"
          placeholder="Value"
        />
      </div>
      <div class="flex items-center justify-between text-xs text-muted">
        <span>{{ summaryCondition(condition) }}</span>
        <UButton
          size="xs"
          icon="i-lucide-trash-2"
          color="error"
          variant="ghost"
          aria-label="Remove condition"
          @click="remove('all', Number(index))"
        />
      </div>
    </div>

    <div
      v-for="(condition, index) in group.any || []"
      :key="`any-${index}`"
      class="rounded border border-dashed p-2 space-y-2"
    >
      <ConditionGroupEditor
        v-if="condition.all || condition.any"
        :model-value="condition"
        :references="references"
        title="Nested ANY"
        :depth="(depth || 0) + 1"
        @update:model-value="value => setCondition('any', Number(index), value)"
      />
      <div
        v-else
        class="grid grid-cols-1 md:grid-cols-4 gap-2"
      >
        <USelect
          v-model="condition.kind"
          :items="conditionKinds"
        />
        <ReferenceSelect
          v-if="condition.kind === 'label'"
          v-model="condition.labelId"
          :items="references.labels"
          placeholder="Label"
        />
        <ReferenceSelect
          v-else-if="condition.kind === 'cycleRound'"
          v-model="condition.value"
          :items="references.rounds"
          placeholder="Round"
        />
        <ReferenceSelect
          v-else-if="['reviewField', 'reviewScore', 'reviewCount', 'reviewSpread'].includes(condition.kind)"
          v-model="condition.stageId"
          :items="references.stages"
          placeholder="Review stage"
        />
        <ReferenceSelect
          v-else-if="condition.kind === 'field'"
          v-model="condition.name"
          :items="references.fields"
          placeholder="Field"
        />
        <UInput
          v-else
          v-model="condition.value"
          placeholder="Value"
        />
        <USelect
          v-model="condition.op"
          :items="operators"
        />
        <UInput
          v-if="!['isNull', 'notNull', 'hasLabel', 'lacksLabel'].includes(condition.op) && !['label', 'cycleRound'].includes(condition.kind)"
          v-model="condition.value"
          placeholder="Value"
        />
      </div>
      <div class="flex items-center justify-between text-xs text-muted">
        <span>{{ summaryCondition(condition) }}</span>
        <UButton
          size="xs"
          icon="i-lucide-trash-2"
          color="error"
          variant="ghost"
          aria-label="Remove condition"
          @click="remove('any', Number(index))"
        />
      </div>
    </div>
  </div>
</template>
