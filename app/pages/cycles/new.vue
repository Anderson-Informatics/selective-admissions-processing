<script setup lang="ts">
const toast = useToast()
const router = useRouter()
const loading = ref(false)

const state = reactive({
  year: '',
  name: '',
  active: false,
  startDate: '',
  endDate: ''
})

async function onSubmit() {
  loading.value = true
  try {
    await $fetch('/api/cycles', {
      method: 'POST',
      body: {
        year: state.year,
        name: state.name,
        active: state.active,
        startDate: state.startDate || undefined,
        endDate: state.endDate || undefined
      }
    })
    toast.add({ title: 'Cycle created', color: 'success' })
    await navigateTo('/cycles')
  } catch (err: any) {
    toast.add({
      title: err.data?.statusMessage || 'Failed to create cycle',
      color: 'error'
    })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UContainer class="py-8 max-w-xl">
    <h1 class="text-2xl font-semibold mb-6">
      New Cycle
    </h1>

    <form class="space-y-4" @submit.prevent="onSubmit">
      <UFormField label="Year" required>
        <UInput v-model="state.year" placeholder="2026-2027" required />
      </UFormField>

      <UFormField label="Name" required>
        <UInput v-model="state.name" required />
      </UFormField>

      <UFormField label="Active cycle">
        <UCheckbox v-model="state.active" label="Make this the active cycle" />
      </UFormField>

      <UFormField label="Start date">
        <UInput v-model="state.startDate" type="date" />
      </UFormField>

      <UFormField label="End date">
        <UInput v-model="state.endDate" type="date" />
      </UFormField>

      <div class="flex gap-2 pt-2">
        <UButton type="submit" label="Create cycle" :loading="loading" />
        <UButton
          to="/cycles"
          label="Cancel"
          color="neutral"
          variant="outline"
        />
      </div>
    </form>
  </UContainer>
</template>
