<script setup lang="ts">
import type { DashboardHighlightResult } from '~/utils/dashboard'

defineProps<{ highlight: DashboardHighlightResult }>()

function formatPercent(percent: number | null) {
  return percent == null ? '—' : `${percent}%`
}
</script>

<template>
  <UCard>
    <p class="text-sm text-muted">
      {{ highlight.label }}
    </p>
    <div class="mt-2 flex items-end justify-between gap-4">
      <p class="text-3xl font-semibold">
        {{ formatPercent(highlight.percent) }}
      </p>
      <p class="text-sm text-muted">
        {{ highlight.completed.toLocaleString() }} / {{ highlight.total.toLocaleString() }}
      </p>
    </div>
    <UProgress
      :model-value="highlight.percent || 0"
      :max="100"
      size="sm"
      class="mt-3"
    />
    <div
      v-if="highlight.segments.length"
      class="mt-4 space-y-2 border-t border-default pt-3"
    >
      <div
        v-for="segment in highlight.segments"
        :key="segment.key"
        class="flex items-center justify-between gap-3 text-sm"
      >
        <span class="truncate text-muted">{{ segment.label }}</span>
        <span class="flex shrink-0 items-center gap-2">
          <span>{{ segment.completed.toLocaleString() }} / {{ segment.total.toLocaleString() }}</span>
          <UBadge
            :label="formatPercent(segment.percent)"
            color="neutral"
            variant="soft"
          />
        </span>
      </div>
    </div>
  </UCard>
</template>
