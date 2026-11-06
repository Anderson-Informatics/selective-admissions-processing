<script setup lang="ts">
interface Cycle {
  _id: string
  year: string
  name: string
  active: boolean
  startDate?: string
  endDate?: string
}

const route = useRoute()
const toast = useToast()
const loading = ref(false)
const deleteLoading = ref(false)

const { data: cycle, status } = await useFetch<Cycle>(`/api/cycles/${route.params.id}`)

const state = reactive({
  year: '',
  name: '',
  active: false,
  startDate: '',
  endDate: ''
})

function formatDate(value?: string): string {
  if (!value) return ''
  return new Date(value).toISOString().split('T')[0] || ''
}

watchEffect(() => {
  if (cycle.value) {
    state.year = cycle.value.year
    state.name = cycle.value.name
    state.active = cycle.value.active
    state.startDate = formatDate(cycle.value.startDate)
    state.endDate = formatDate(cycle.value.endDate)
  }
})

async function onSubmit() {
  loading.value = true
  try {
    await $fetch(`/api/cycles/${route.params.id}`, {
      method: 'PUT',
      body: {
        year: state.year,
        name: state.name,
        active: state.active,
        startDate: state.startDate || undefined,
        endDate: state.endDate || undefined
      }
    })
    toast.add({ title: 'Cycle updated', color: 'success' })
  } catch (err: unknown) {
    const message = (err as { data?: { statusMessage?: string } }).data?.statusMessage
    toast.add({
      title: message || 'Failed to update cycle',
      color: 'error'
    })
  } finally {
    loading.value = false
  }
}

async function onDelete() {
  if (!confirm('Are you sure you want to delete this cycle?')) return
  deleteLoading.value = true
  try {
    await $fetch(`/api/cycles/${route.params.id}`, { method: 'DELETE' })
    toast.add({ title: 'Cycle deleted', color: 'success' })
    await navigateTo('/cycles')
  } catch (err: unknown) {
    const message = (err as { data?: { statusMessage?: string } }).data?.statusMessage
    toast.add({
      title: message || 'Failed to delete cycle',
      color: 'error'
    })
  } finally {
    deleteLoading.value = false
  }
}
</script>

<template>
  <UContainer class="py-8 max-w-5xl">
    <h1 class="text-2xl font-semibold mb-6">
      Edit Cycle
    </h1>

    <div
      v-if="status === 'pending'"
      class="text-muted"
    >
      Loading...
    </div>

    <form
      v-else
      class="space-y-4"
      @submit.prevent="onSubmit"
    >
      <UFormField
        label="Year"
        required
      >
        <UInput
          v-model="state.year"
          placeholder="2026-2027"
          required
        />
      </UFormField>

      <UFormField
        label="Name"
        required
      >
        <UInput
          v-model="state.name"
          required
        />
      </UFormField>

      <UFormField label="Active cycle">
        <UCheckbox
          v-model="state.active"
          label="Make this the active cycle"
        />
      </UFormField>

      <UFormField label="Start date">
        <UInput
          v-model="state.startDate"
          type="date"
        />
      </UFormField>

      <UFormField label="End date">
        <UInput
          v-model="state.endDate"
          type="date"
        />
      </UFormField>

      <div class="flex gap-2 pt-2">
        <UButton
          type="submit"
          label="Save changes"
          :loading="loading"
        />
        <UButton
          to="/cycles"
          label="Cancel"
          color="neutral"
          variant="outline"
        />
        <UButton
          color="error"
          variant="outline"
          label="Delete"
          :loading="deleteLoading"
          class="ms-auto"
          @click="onDelete"
        />
      </div>
    </form>
  </UContainer>
</template>
