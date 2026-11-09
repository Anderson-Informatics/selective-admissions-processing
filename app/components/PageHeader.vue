<script setup lang="ts">
import type { PageHelpKey } from '~/utils/pageHelp'

defineProps<{ title: string, help: PageHelpKey }>()
</script>

<template>
  <div class="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
    <div class="min-w-0">
      <h1 class="text-2xl font-semibold">
        {{ title }}
      </h1>
      <slot />
    </div>
    <div
      v-if="$slots.actions"
      class="col-span-2 row-start-2 flex flex-wrap items-center gap-2 sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:justify-end"
    >
      <slot name="actions" />
    </div>
    <div class="col-start-2 row-start-1 sm:col-start-3">
      <PageHelp :page="help" />
    </div>
  </div>
</template>
