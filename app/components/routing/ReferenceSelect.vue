<script setup lang="ts">
import type { SelectItem } from '@nuxt/ui'

defineProps<{
  modelValue?: string | string[]
  items: SelectItem[]
  multiple?: boolean
  placeholder?: string
  showDescriptionTooltip?: boolean
}>()

defineEmits<{ 'update:modelValue': [value: string | string[]] }>()

function optionLabel(item: SelectItem): string {
  return typeof item === 'object' && item !== null && 'label' in item ? String(item.label ?? '') : String(item ?? '')
}

function optionDescription(item: SelectItem): string {
  return typeof item === 'object' && item !== null && 'questionText' in item ? String(item.questionText ?? '') : ''
}
</script>

<template>
  <USelectMenu
    :model-value="modelValue"
    :items="items"
    :multiple="multiple"
    value-key="value"
    :search-input="{ placeholder: 'Search...' }"
    :filter-fields="showDescriptionTooltip ? ['label', 'questionText'] : undefined"
    :placeholder="placeholder || 'Select...'"
    class="w-full"
    @update:model-value="$emit('update:modelValue', Array.isArray($event) ? $event.map(String) : String($event || ''))"
  >
    <template #item-label="{ item }">
      <UTooltip
        v-if="showDescriptionTooltip && optionDescription(item)"
      >
        <span>{{ optionLabel(item) }}</span>
        <template #content>
          <p class="max-w-xs whitespace-normal text-xs">
            {{ optionDescription(item) }}
          </p>
        </template>
      </UTooltip>
      <span v-else>{{ optionLabel(item) }}</span>
    </template>
  </USelectMenu>
</template>
