<script setup lang="ts">
interface Cycle {
  _id: string
  year: string
  name: string
  active: boolean
  startDate?: string
  endDate?: string
  rounds?: CycleRound[]
}

interface CycleRound {
  key: string
  name: string
  order: number
  startDate: string
  endDate: string
  active: boolean
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
  endDate: '',
  rounds: [] as CycleRound[]
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
    state.rounds = (cycle.value.rounds || []).map(round => ({
      key: round.key,
      name: round.name,
      order: round.order,
      startDate: formatDate(round.startDate),
      endDate: formatDate(round.endDate),
      active: round.active !== false
    }))
  }
})

function addRound() {
  const order = state.rounds.length + 1
  state.rounds.push({ key: `round-${order}`, name: `Round ${order}`, order, startDate: '', endDate: '', active: true })
}

function removeRound(index: number) {
  state.rounds.splice(index, 1)
  state.rounds.forEach((round, roundIndex) => {
    round.order = roundIndex + 1
  })
}

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
        endDate: state.endDate || undefined,
        rounds: state.rounds
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
  <UContainer class="py-8 max-w-xl">
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

      <div class="space-y-3 rounded-lg border p-4">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="font-medium">
              Admission rounds
            </h2>
            <p class="text-sm text-muted">
              Inclusive date ranges determine a submission's routing round from submissionDate.
            </p>
          </div>
          <UButton
            label="Add round"
            color="neutral"
            variant="outline"
            @click="addRound"
          />
        </div>
        <div
          v-if="!state.rounds.length"
          class="text-sm text-muted"
        >
          No rounds configured.
        </div>
        <div
          v-for="(round, index) in state.rounds"
          :key="round.key"
          class="grid grid-cols-1 md:grid-cols-5 gap-2 items-end"
        >
          <UFormField label="Key">
            <UInput
              v-model="round.key"
              placeholder="round-1"
            />
          </UFormField>
          <UFormField label="Name">
            <UInput
              v-model="round.name"
              placeholder="Round 1"
            />
          </UFormField>
          <UFormField label="Start">
            <UInput
              v-model="round.startDate"
              type="date"
            />
          </UFormField>
          <UFormField label="End">
            <UInput
              v-model="round.endDate"
              type="date"
            />
          </UFormField>
          <div class="flex items-center gap-2">
            <UCheckbox
              v-model="round.active"
              label="Active"
            />
            <UButton
              icon="i-lucide-trash-2"
              color="error"
              variant="ghost"
              aria-label="Remove round"
              @click="removeRound(index)"
            />
          </div>
        </div>
      </div>

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
