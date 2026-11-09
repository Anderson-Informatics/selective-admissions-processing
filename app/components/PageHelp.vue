<script setup lang="ts">
import { pageHelp } from '~/utils/pageHelp'
import type { PageHelpKey } from '~/utils/pageHelp'

const props = defineProps<{ page: PageHelpKey }>()
const content = computed(() => pageHelp[props.page])
const open = ref(false)
</script>

<template>
  <UModal
    v-model:open="open"
    :title="`Help: ${content.title}`"
    description="What this page is for and how to use it."
    :ui="{ content: 'max-w-2xl', body: 'space-y-6', footer: 'justify-end' }"
  >
    <UTooltip text="Help for this page">
      <UButton
        icon="i-lucide-circle-help"
        color="neutral"
        variant="ghost"
        :aria-label="`Help for ${content.title}`"
        class="shrink-0"
      />
    </UTooltip>

    <template #body>
      <section>
        <h2 class="font-semibold text-highlighted mb-2">
          What this page is for
        </h2>
        <p class="text-sm text-muted leading-relaxed">
          {{ content.purpose }}
        </p>
      </section>
      <section>
        <h2 class="font-semibold text-highlighted mb-2">
          What you can do here
        </h2>
        <ul class="list-disc ps-5 space-y-2 text-sm text-muted leading-relaxed">
          <li
            v-for="task in content.tasks"
            :key="task"
          >
            {{ task }}
          </li>
        </ul>
      </section>
      <section>
        <h2 class="font-semibold text-highlighted mb-2">
          How to get started
        </h2>
        <p class="text-sm text-muted leading-relaxed">
          {{ content.gettingStarted }}
        </p>
      </section>
      <section>
        <h2 class="font-semibold text-highlighted mb-2">
          Important things to know
        </h2>
        <ul class="list-disc ps-5 space-y-2 text-sm text-muted leading-relaxed">
          <li
            v-for="note in content.important"
            :key="note"
          >
            {{ note }}
          </li>
        </ul>
      </section>
    </template>

    <template #footer>
      <UButton
        label="Close"
        color="neutral"
        variant="outline"
        @click="open = false"
      />
    </template>
  </UModal>
</template>
