<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

interface Cycle {
  _id: string
  year: string
  name: string
  active: boolean
  startDate?: string
  endDate?: string
}

const toast = useToast()

const { data: cycles, refresh, status } = await useFetch<Cycle[]>('/api/cycles')

const columns: TableColumn<Cycle>[] = [
  { accessorKey: 'year', header: 'Year' },
  { accessorKey: 'name', header: 'Name' },
  { id: 'active', accessorKey: 'active', header: 'Active' },
  { id: 'actions', header: 'Actions', enableSorting: false }
]

const cloneModalOpen = ref(false)
const cloneSource = ref<Cycle | null>(null)
const cloneState = reactive({
  year: '',
  name: '',
  startDate: '',
  endDate: ''
})
const cloneLoading = ref(false)

function formatDate(value?: string) {
  if (!value) return ''
  return new Date(value).toISOString().split('T')[0]
}

function openClone(cycle: Cycle) {
  cloneSource.value = cycle
  cloneState.year = ''
  cloneState.name = `${cycle.name} (Copy)`
  cloneState.startDate = formatDate(cycle.startDate)
  cloneState.endDate = formatDate(cycle.endDate)
  cloneModalOpen.value = true
}

async function confirmClone() {
  if (!cloneSource.value) return
  cloneLoading.value = true
  try {
    await $fetch(`/api/cycles/${cloneSource.value._id}/clone`, {
      method: 'POST',
      body: {
        year: cloneState.year,
        name: cloneState.name,
        startDate: cloneState.startDate || undefined,
        endDate: cloneState.endDate || undefined
      }
    })
    toast.add({ title: 'Cycle cloned', color: 'success' })
    cloneModalOpen.value = false
    await refresh()
  } catch (err: unknown) {
    toast.add({
      title: (err as { data?: { statusMessage?: string } }).data?.statusMessage || 'Failed to clone cycle',
      color: 'error'
    })
  } finally {
    cloneLoading.value = false
  }
}

async function deleteCycle(id: string) {
  if (!confirm('Are you sure you want to delete this cycle?')) return
  try {
    await $fetch(`/api/cycles/${id}`, { method: 'DELETE' })
    toast.add({ title: 'Cycle deleted', color: 'success' })
    await refresh()
  } catch (err: unknown) {
    toast.add({
      title: (err as { data?: { statusMessage?: string } }).data?.statusMessage || 'Failed to delete cycle',
      color: 'error'
    })
  }
}
</script>

<template>
  <UContainer class="py-8">
    <div class="flex justify-between items-center mb-6">
      <h1 class="text-2xl font-semibold">
        Cycles
      </h1>
      <UButton
        to="/cycles/new"
        icon="i-lucide-plus"
        label="New cycle"
      />
    </div>

    <UTable
      :data="cycles || []"
      :columns="columns"
      :loading="status === 'pending'"
    >
      <template #active-cell="{ row }">
        <UBadge
          :label="row.original.active ? 'Active' : 'Inactive'"
          :color="row.original.active ? 'success' : 'neutral'"
          variant="subtle"
        />
      </template>

      <template #actions-cell="{ row }">
        <div class="flex gap-1">
          <UButton
            icon="i-lucide-pencil"
            color="neutral"
            variant="ghost"
            :to="`/cycles/${row.original._id}`"
            aria-label="Edit"
          />
          <UButton
            icon="i-lucide-copy"
            color="neutral"
            variant="ghost"
            aria-label="Clone"
            @click="openClone(row.original)"
          />
          <UButton
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            aria-label="Delete"
            @click="deleteCycle(row.original._id)"
          />
        </div>
      </template>
    </UTable>

    <UModal
      v-model:open="cloneModalOpen"
      title="Clone cycle"
      description="Enter details for the cloned cycle."
    >
      <template #body>
        <UFormField label="Year" required>
          <UInput v-model="cloneState.year" placeholder="2026-2027" />
        </UFormField>
        <UFormField label="Name" required class="mt-4">
          <UInput v-model="cloneState.name" />
        </UFormField>
        <UFormField label="Start date" class="mt-4">
          <UInput v-model="cloneState.startDate" type="date" />
        </UFormField>
        <UFormField label="End date" class="mt-4">
          <UInput v-model="cloneState.endDate" type="date" />
        </UFormField>
      </template>

      <template #footer="{ close }">
        <UButton
          color="neutral"
          variant="outline"
          label="Cancel"
          @click="close"
        />
        <UButton
          label="Clone"
          :loading="cloneLoading"
          @click="confirmClone"
        />
      </template>
    </UModal>
  </UContainer>
</template>
