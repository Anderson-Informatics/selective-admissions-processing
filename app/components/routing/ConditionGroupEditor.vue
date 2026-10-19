<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SelectItem } from '@nuxt/ui'
import { toRaw } from 'vue'
import { normalizeConditionGroup } from '~~/shared/routingConditions'
import ReferenceSelect from './ReferenceSelect.vue'
import { changeOperator, conditionValueList, newCondition, numericValueList } from './conditionValues'
import { moveSibling } from './reorderConditions'

interface References {
  stages: SelectItem[]
  fields: SelectItem[]
  rounds: SelectItem[]
  labels: SelectItem[]
  reviewFields: Array<{ stageId: string, fields: SelectItem[] }>
}

const props = defineProps<{ modelValue: any, references: References, title?: string, depth?: number }>()
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
  { label: 'GPA record', value: 'gpaRecord' },
  { label: 'Initial form mapped', value: 'mappedInitialForm' },
  { label: 'Pipeline prerequisites complete', value: 'pipelinePrerequisitesComplete' }
]
const comparisons: Array<{ label: string, value: string }> = [
  { label: 'equals', value: 'eq' },
  { label: 'not equals', value: 'ne' },
  { label: 'in', value: 'in' },
  { label: 'not in', value: 'nin' },
  { label: 'greater than', value: 'gt' },
  { label: 'greater than or equal', value: 'gte' },
  { label: 'less than', value: 'lt' },
  { label: 'less than or equal', value: 'lte' },
  { label: 'is present', value: 'notNull' },
  { label: 'is blank', value: 'isNull' }
]

const gpaStatuses: Array<{ label: string, value: string }> = ['Complete', 'Incomplete', 'Partial', 'DPSCD Partial'].map(value => ({ label: value, value }))
const group = computed<any>(() => props.modelValue?.operator ? props.modelValue : normalizeConditionGroup(props.modelValue || { operator: 'and', conditions: [] }))
const numericKinds = ['reviewScore', 'reviewCount', 'reviewSpread']
const rowKeys = ref<number[]>([])
let nextRowKey = 0
let pendingGroup: unknown
watch(() => props.modelValue, (value) => {
  if (toRaw(value) === pendingGroup) {
    pendingGroup = undefined
    return
  }
  const current = normalizeConditionGroup(value || { operator: 'and', conditions: [] }) as { conditions: unknown[] }
  rowKeys.value = current.conditions.map(() => nextRowKey++)
}, { immediate: true })
function numericInput(condition: any): boolean {
  return numericKinds.includes(condition.kind) || ['gt', 'gte', 'lt', 'lte'].includes(condition.op)
}
function options(condition: any): Array<{ label: string, value: string }> {
  if (condition.kind === 'label') return [{ label: 'has label', value: 'hasLabel' }, { label: 'lacks label', value: 'lacksLabel' }]
  if (condition.kind === 'cycleRound') return comparisons.filter(item => ['eq', 'ne', 'in', 'nin', 'isNull', 'notNull'].includes(item.value))
  if (condition.kind === 'gpaStatus') return comparisons.filter(item => ['eq', 'ne', 'in', 'nin'].includes(item.value))
  return comparisons
}
function mappedReviewFields(condition: any): SelectItem[] {
  const stageIds = condition.stageIds?.length ? condition.stageIds : [condition.stageId]
  return [...new Map(props.references.reviewFields?.filter(item => stageIds.includes(item.stageId)).flatMap(item => item.fields).map(item => [typeof item === 'object' && item !== null && 'value' in item ? String(item.value) : String(item), item]) || []).values()]
}
function fieldsFor(condition: any): SelectItem[] {
  const fields = mappedReviewFields(condition)
  const name = condition.name || condition.field
  return name && !fields.some(item => typeof item === 'object' && item !== null && 'value' in item && item.value === name) ? [{ label: `${name} (not mapped)`, value: name }, ...fields] : fields
}
function isUnmapped(condition: any): boolean {
  const name = condition.name || condition.field
  return Boolean(name) && !mappedReviewFields(condition).some(item => typeof item === 'object' && item !== null && 'value' in item && item.value === name)
}
function setGroup(patch: Record<string, unknown>) {
  const value = { ...group.value, ...patch }
  pendingGroup = value
  emit('update:modelValue', value)
}
function add(item: any) {
  rowKeys.value = [...rowKeys.value, nextRowKey++]
  setGroup({ conditions: [...group.value.conditions, item] })
}
function setItem(index: number, item: any) {
  setGroup({ conditions: group.value.conditions.map((value: any, i: number) => i === index ? item : value) })
}
function setProperty(index: number, key: string, value: unknown) {
  setItem(index, { ...group.value.conditions[index], [key]: value })
}
function setKind(index: number, kind: string) {
  setItem(index, newCondition(kind))
}
function setStage(index: number, stageId: string) {
  const { name: _name, field: _field, ...condition } = group.value.conditions[index]
  setItem(index, { ...condition, stageId })
}
function setStageIds(index: number, stageIds: string[]) {
  const condition = group.value.conditions[index]
  if (condition.kind === 'reviewField') {
    const { name: _name, field: _field, ...rest } = condition
    setItem(index, { ...rest, stageIds })
    return
  }
  setItem(index, { ...condition, stageIds })
}
function setGpaSource(index: number, source: string) {
  const { quartersAvailable: _quarters, termsEnrolled: _terms, ...condition } = group.value.conditions[index]
  const threshold = typeof condition.exists !== 'boolean' && (_quarters !== undefined || _terms !== undefined)
  setItem(index, threshold && source !== 'any' ? { ...condition, source, [source === 'dpscd' ? 'quartersAvailable' : 'termsEnrolled']: 0 } : { ...condition, source, exists: typeof condition.exists === 'boolean' ? condition.exists : true })
}
function setGpaMode(index: number, mode: string) {
  const { exists: _exists, quartersAvailable: _quarters, termsEnrolled: _terms, ...condition } = group.value.conditions[index]
  setItem(index, mode === 'threshold' ? { ...condition, source: condition.source === 'optIn' ? 'optIn' : 'dpscd', op: 'gte', [condition.source === 'optIn' ? 'termsEnrolled' : 'quartersAvailable']: 0 } : { ...condition, exists: true })
}
function setOp(index: number, op: string) {
  setItem(index, changeOperator(group.value.conditions[index], op))
}
function setNumeric(index: number, key: string, value: string | number) {
  setProperty(index, key, value === '' ? undefined : Number(value))
}
function setValues(index: number, values: string[]) {
  setProperty(index, 'value', numericValueList(group.value.conditions[index], values))
}
function remove(index: number) {
  rowKeys.value = rowKeys.value.filter((_, i) => i !== index)
  setGroup({ conditions: group.value.conditions.filter((_: unknown, i: number) => i !== index) })
}
function move(index: number, direction: -1 | 1) {
  const conditions = moveSibling(group.value.conditions as any[], index, direction)
  if (conditions === group.value.conditions) return
  rowKeys.value = moveSibling(rowKeys.value, index, direction)
  setGroup({ conditions })
}
</script>

<template>
  <div
    :class="depth ? 'ms-3 rounded-lg border border-default bg-muted/20 p-3 space-y-3' : 'space-y-3'"
  >
    <div
      class="flex flex-wrap items-center justify-between gap-2"
    >
      <div class="flex items-center gap-2">
        <strong
          v-if="title"
          class="text-sm"
        >{{ title }}</strong>
        <span
          v-else
          class="text-xs text-muted"
        >Group</span>
      </div>
      <div class="flex gap-1">
        <UButton
          size="xs"
          label="Add condition"
          color="neutral"
          variant="soft"
          @click="add(newCondition('field'))"
        />
        <UButton
          size="xs"
          label="Add group"
          color="neutral"
          variant="soft"
          @click="add({ operator: 'and', conditions: [newCondition('field')] })"
        />
      </div>
    </div>
    <p
      v-if="!group.conditions.length"
      class="text-sm text-muted"
    >
      No conditions configured. An empty root matches all submissions.
    </p>
    <div
      v-for="(item, index) in group.conditions"
      :key="rowKeys[Number(index)]"
      class="space-y-2"
    >
      <UDropdownMenu
        v-if="index"
        :items="[
          { label: 'AND', icon: group.operator === 'and' ? 'i-lucide-check' : undefined, onSelect: () => setGroup({ operator: 'and' }) },
          { label: 'OR', icon: group.operator === 'or' ? 'i-lucide-check' : undefined, onSelect: () => setGroup({ operator: 'or' }) }
        ]"
      >
        <UButton
          :label="group.operator.toUpperCase()"
          color="primary"
          variant="link"
          size="xs"
          trailing-icon="i-lucide-chevron-down"
          :aria-label="`Change group operator, currently ${group.operator.toUpperCase()}`"
        />
      </UDropdownMenu>
      <div class="flex items-start gap-2">
        <ConditionGroupEditor
          v-if="item.operator"
          :model-value="item"
          :references="references"
          :depth="(depth || 0) + 1"
          class="min-w-0 flex-1"
          @update:model-value="value => setItem(Number(index), value)"
        />
        <div
          v-else
          class="min-w-0 flex-1 space-y-2"
        >
          <div class="flex flex-wrap items-center gap-2">
            <USelect
              :model-value="item.kind"
              :items="conditionKinds"
              class="min-w-36"
              aria-label="Condition kind"
              @update:model-value="setKind(Number(index), String($event))"
            />
            <ReferenceSelect
              v-if="item.kind === 'field'"
              :model-value="item.name || item.field"
              :items="references.fields"
              placeholder="Submission field"
              class="min-w-36 flex-1"
              @update:model-value="setProperty(Number(index), 'name', $event)"
            />
            <template v-if="['reviewField', 'reviewScore', 'reviewCount', 'reviewSpread'].includes(item.kind)">
              <ReferenceSelect
                v-if="item.stageIds?.length"
                :model-value="item.stageIds"
                :items="references.stages"
                multiple
                placeholder="Review stages"
                class="min-w-36 flex-1"
                @update:model-value="setStageIds(Number(index), Array.isArray($event) ? $event : [$event])"
              />
              <ReferenceSelect
                v-else
                :model-value="item.stageId"
                :items="references.stages"
                placeholder="Review stage"
                class="min-w-36 flex-1"
                @update:model-value="setStage(Number(index), String($event))"
              />
              <ReferenceSelect
                v-if="item.kind === 'reviewField'"
                :model-value="item.name || item.field"
                :items="fieldsFor(item)"
                placeholder="Mapped review field"
                show-description-tooltip
                class="min-w-36 flex-1"
                @update:model-value="setItem(Number(index), { ...item, name: $event, field: undefined })"
              />
            </template>
            <ReferenceSelect
              v-if="item.kind === 'gpaRecord'"
              :model-value="item.source || 'any'"
              :items="[{ label: 'Any GPA record', value: 'any' }, { label: 'DPSCD', value: 'dpscd' }, { label: 'Opt-in', value: 'optIn' }]"
              placeholder="Source"
              class="min-w-36 flex-1"
              @update:model-value="setGpaSource(Number(index), String($event))"
            />
            <USelect
              v-if="item.kind === 'gpaRecord'"
              :model-value="typeof item.exists !== 'boolean' && (item.quartersAvailable !== undefined || item.termsEnrolled !== undefined) ? 'threshold' : 'exists'"
              :items="[{ label: 'Record exists', value: 'exists' }, { label: 'History threshold', value: 'threshold' }]"
              class="min-w-36"
              aria-label="GPA record check"
              @update:model-value="setGpaMode(Number(index), String($event))"
            />
            <USelect
              v-if="item.kind === 'hsptLinked' || (item.kind === 'gpaRecord' && (typeof item.exists === 'boolean' || (item.quartersAvailable === undefined && item.termsEnrolled === undefined)))"
              :model-value="item.exists"
              :items="[{ label: item.kind === 'hsptLinked' ? 'Linked' : 'Record exists', value: true }, { label: item.kind === 'hsptLinked' ? 'Not linked' : 'No record', value: false }]"
              class="min-w-36"
              aria-label="Exists"
              @update:model-value="setProperty(Number(index), 'exists', $event)"
            />
            <USelect
              v-if="!['hsptLinked', 'gpaRecord', 'pipelinePrerequisitesComplete', 'mappedInitialForm'].includes(item.kind)"
              :model-value="item.kind === 'label' ? (item.op === 'lacksLabel' ? 'lacksLabel' : 'hasLabel') : item.op || 'eq'"
              :items="options(item)"
              class="min-w-36"
              aria-label="Comparison operator"
              @update:model-value="setOp(Number(index), String($event))"
            />
            <ReferenceSelect
              v-if="item.kind === 'label'"
              :model-value="item.labelId"
              :items="references.labels"
              placeholder="Label"
              class="min-w-36 flex-1"
              @update:model-value="setProperty(Number(index), 'labelId', $event)"
            />
            <USelect
              v-else-if="item.kind === 'mappedInitialForm'"
              :model-value="item.value !== false"
              :items="[{ label: 'Mapped', value: true }, { label: 'Not mapped', value: false }]"
              class="min-w-36"
              @update:model-value="setItem(Number(index), { ...item, op: 'eq', value: $event })"
            />
            <ReferenceSelect
              v-else-if="item.kind === 'cycleRound' && !['in', 'nin', 'isNull', 'notNull'].includes(item.op)"
              :model-value="item.value"
              :items="references.rounds"
              placeholder="Round"
              class="min-w-36 flex-1"
              @update:model-value="setProperty(Number(index), 'value', $event)"
            />
            <ReferenceSelect
              v-else-if="item.kind === 'gpaStatus' && !['in', 'nin', 'isNull', 'notNull'].includes(item.op)"
              :model-value="item.value"
              :items="gpaStatuses"
              placeholder="GPA status"
              class="min-w-36 flex-1"
              @update:model-value="setProperty(Number(index), 'value', $event)"
            />
            <UInputMenu
              v-else-if="item.kind === 'gpaStatus' && ['in', 'nin'].includes(item.op)"
              :model-value="conditionValueList(item)"
              :items="gpaStatuses"
              value-key="value"
              multiple
              placeholder="Select GPA statuses"
              class="min-w-44 flex-1"
              @update:model-value="setValues(Number(index), $event.map(String))"
            />
            <UInputMenu
              v-else-if="item.kind === 'cycleRound' && ['in', 'nin'].includes(item.op)"
              :model-value="conditionValueList(item)"
              :items="references.rounds"
              value-key="value"
              multiple
              placeholder="Select rounds"
              class="min-w-44 flex-1"
              @update:model-value="setValues(Number(index), $event.filter(value => value != null).map(String))"
            />
            <UInputTags
              v-else-if="['in', 'nin'].includes(item.op) && !['label', 'hsptLinked', 'gpaRecord', 'gpaStatus', 'cycleRound'].includes(item.kind)"
              :model-value="conditionValueList(item)"
              placeholder="Enter a value and press Enter"
              class="min-w-44 flex-1"
              @update:model-value="setValues(Number(index), $event)"
            />
            <UInput
              v-else-if="!['label', 'cycleRound', 'gpaStatus', 'hsptLinked', 'gpaRecord', 'mappedInitialForm', 'pipelinePrerequisitesComplete'].includes(item.kind) && !['isNull', 'notNull'].includes(item.op)"
              :model-value="item.value"
              :type="numericInput(item) ? 'number' : 'text'"
              placeholder="Value"
              class="min-w-36 flex-1"
              @update:model-value="numericInput(item) ? setNumeric(Number(index), 'value', $event) : setProperty(Number(index), 'value', $event)"
            />
            <template v-if="item.kind === 'gpaRecord' && typeof item.exists !== 'boolean' && (item.quartersAvailable !== undefined || item.termsEnrolled !== undefined)">
              <USelect
                :model-value="item.op || 'gte'"
                :items="comparisons.filter(option => ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'].includes(option.value))"
                class="min-w-36"
                @update:model-value="setOp(Number(index), String($event))"
              />
              <UInput
                :model-value="item.source === 'dpscd' ? item.quartersAvailable : item.termsEnrolled"
                type="number"
                :placeholder="item.source === 'dpscd' ? 'Quarters available' : 'Terms enrolled'"
                class="min-w-36 flex-1"
                @update:model-value="setNumeric(Number(index), item.source === 'dpscd' ? 'quartersAvailable' : 'termsEnrolled', $event)"
              />
            </template>
          </div>
          <p
            v-if="item.kind === 'reviewField' && (item.stageId || item.stageIds?.length) && !mappedReviewFields(item).length"
            class="text-xs text-warning"
          >
            No mapped fields are available for this review form.
          </p>
          <p
            v-if="item.kind === 'reviewField' && (item.stageId || item.stageIds?.length) && isUnmapped(item)"
            class="text-xs text-warning"
          >
            This field is not mapped on the selected review form.
          </p>
        </div>
        <div class="flex shrink-0 flex-col items-center">
          <UButton
            size="xs"
            icon="i-lucide-chevron-up"
            color="neutral"
            variant="ghost"
            :aria-label="item.operator ? 'Move group up' : 'Move condition up'"
            :disabled="Number(index) === 0"
            @click="move(Number(index), -1)"
          />
          <UButton
            size="xs"
            icon="i-lucide-chevron-down"
            color="neutral"
            variant="ghost"
            :aria-label="item.operator ? 'Move group down' : 'Move condition down'"
            :disabled="Number(index) === group.conditions.length - 1"
            @click="move(Number(index), 1)"
          />
          <UButton
            size="xs"
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            :aria-label="item.operator ? 'Remove group' : 'Remove condition'"
            :disabled="Boolean(depth) && group.conditions.length === 1"
            @click="remove(Number(index))"
          />
        </div>
      </div>
    </div>
  </div>
</template>
