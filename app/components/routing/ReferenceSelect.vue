<script setup lang="ts">
import type { SelectItem } from '@nuxt/ui'

defineProps<{
  modelValue?: string | string[]
  items: SelectItem[]
  multiple?: boolean
  placeholder?: string
}>()

defineEmits<{ 'update:modelValue': [value: string | string[]] }>()
</script>

<template>
  <USelect
    :model-value="modelValue"
    :items="items"
    :multiple="multiple"
    :search-input="{ placeholder: 'Search...' }"
    :placeholder="placeholder || 'Select...'"
    class="w-full"
    @update:model-value="$emit('update:modelValue', Array.isArray($event) ? $event.map(String) : String($event || ''))"
  />
</template>
