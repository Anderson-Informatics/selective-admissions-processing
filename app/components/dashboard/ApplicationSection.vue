<script setup lang="ts">
import type { ApplicationDashboard } from '~/utils/dashboard'

defineProps<{ application: ApplicationDashboard }>()
</script>

<template>
  <section class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <h2 class="text-lg font-semibold">
          {{ application.name }}
        </h2>
        <UBadge :label="application.type" color="neutral" variant="soft" class="capitalize" />
      </div>
      <div class="flex items-center gap-3">
        <UBadge :label="`${application.total.toLocaleString()} submissions`" color="neutral" variant="soft" />
        <UButton to="/submissions" label="View submissions" color="neutral" variant="link" class="p-0" size="sm" />
      </div>
    </div>

    <div v-if="application.highlights.length" class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <DashboardHighlightCard v-for="highlight in application.highlights" :key="highlight.key" :highlight="highlight" />
    </div>

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <template #header>
        <h3 class="font-semibold">
          Review stage completion
        </h3>
      </template>
      <div v-if="application.stages.length" class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-muted/50 text-left">
            <tr>
              <th class="p-3 font-medium">
                Stage
              </th>
              <th class="p-3 font-medium">
                Role
              </th>
              <th class="p-3 text-right font-medium">
                Required
              </th>
              <th class="p-3 text-right font-medium">
                Completed
              </th>
              <th class="p-3 font-medium w-48">
                Progress
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="stage in application.stages" :key="stage.stageId" class="border-t">
              <td class="p-3 font-medium">
                {{ stage.name }}
              </td>
              <td class="p-3 capitalize text-muted">
                {{ stage.role }}
              </td>
              <td class="p-3 text-right">
                {{ stage.required.toLocaleString() }}
              </td>
              <td class="p-3 text-right">
                {{ stage.completed.toLocaleString() }}
              </td>
              <td class="p-3">
                <div class="flex items-center gap-2">
                  <UProgress :model-value="stage.percent || 0" :max="100" size="xs" class="flex-1" />
                  <span class="w-10 text-right text-muted">{{ stage.percent == null ? '—' : `${stage.percent}%` }}</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="p-6 text-center text-sm text-muted">
        No review completion data yet. Run the Refresh review completion job to populate stage stats.
      </p>
    </UCard>
  </section>
</template>
