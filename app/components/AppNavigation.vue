<script setup lang="ts">
import { isNavigationActive, navigationGroups } from '~/utils/navigation'

const emit = defineEmits<{ select: [] }>()
const route = useRoute()
const groups = computed(() => navigationGroups.map(group => ({
  label: group.label,
  items: group.items.map(item => ({
    ...item,
    active: isNavigationActive(route.path, item.to),
    onSelect: () => emit('select')
  }))
})))
</script>

<template>
  <nav
    aria-label="Main navigation"
    class="space-y-4"
  >
    <div
      v-for="group in groups"
      :key="group.label"
    >
      <UNavigationMenu
        :aria-label="group.label"
        :items="[{ type: 'label', label: group.label }, ...group.items]"
        orientation="vertical"
        class="w-full"
      />
    </div>
  </nav>
</template>
