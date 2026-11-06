<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

const auth = useAuth()
const menuOpen = ref(false)
const accountItems = computed<DropdownMenuItem[][]>(() => [
  [{ label: auth.user.value?.email || '', type: 'label' }],
  [{ label: 'Sign out', icon: 'i-lucide-log-out', onSelect: () => auth.logout() }]
])
</script>

<template>
  <UDashboardGroup
    unit="rem"
    :persistent="false"
  >
    <a
      href="#main-content"
      class="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-default focus:p-3 focus:ring-2 focus:ring-primary"
    >
      Skip to content
    </a>

    <UDashboardSidebar
      v-model:open="menuOpen"
      :default-size="15"
      :min-size="15"
      :max-size="15"
      :menu="{ title: 'Main navigation', description: 'Navigate EHS Admissions pages.' }"
      :ui="{ root: 'min-h-0', body: 'min-h-0', footer: 'border-t border-default' }"
    >
      <template #header>
        <NuxtLink
          to="/"
          class="font-semibold text-highlighted truncate"
          @click="menuOpen = false"
        >
          EHS Admissions
        </NuxtLink>
      </template>

      <AppNavigation @select="menuOpen = false" />

      <template #footer>
        <UDropdownMenu
          v-if="auth.user.value"
          :items="accountItems"
          :content="{ align: 'start' }"
          :ui="{ content: 'max-w-[calc(100vw-2rem)]' }"
        >
          <UButton
            :label="auth.user.value.email"
            aria-label="Account menu"
            icon="i-lucide-circle-user-round"
            trailing-icon="i-lucide-chevron-up"
            color="neutral"
            variant="ghost"
            class="w-full"
            :ui="{ label: 'truncate', trailingIcon: 'ms-auto' }"
          />
        </UDropdownMenu>
      </template>
    </UDashboardSidebar>

    <UDashboardPanel :ui="{ root: 'min-h-0' }">
      <template #default>
        <UDashboardNavbar>
          <template #left>
            <span class="font-semibold text-highlighted">EHS Admissions</span>
          </template>
        </UDashboardNavbar>
        <main
          id="main-content"
          tabindex="-1"
          class="min-h-0 min-w-0 flex-1 overflow-auto"
        >
          <slot />
        </main>
      </template>
    </UDashboardPanel>
  </UDashboardGroup>
</template>
