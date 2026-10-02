<script setup lang="ts">
import type { SelectItem } from '@nuxt/ui'
import type { ApplicationDashboard } from '~/utils/dashboard'

interface Cycle {
  _id: string
  year: string
  name: string
  active: boolean
}

interface DashboardJob {
  _id: string
  type: string
  status: string
  progress?: { percent?: number, message?: string }
  startedAt?: string
  createdAt: string
}

interface DashboardSummary {
  totals: {
    applications: number
    submissions: number
    mapped: number
    completed: number
    totalReviews: number
    completedReviews: number
    jobs: number
    activeJobs: number
    openIssues: number
  }
  byApplication: {
    applicationId: string
    name: string
    type: string
    total: number
    mapped: number
    completed: number
  }[]
  applications: ApplicationDashboard[]
  byReviewStage: { name: string, total: number, completed: number, percent: number }[]
  byStatus: { name: string, total: number }[]
  bySeverity: { name: string, total: number }[]
  recentJobs: DashboardJob[]
}

useSeoMeta({ title: 'Dashboard' })

const { data: cycles } = await useFetch<Cycle[]>('/api/cycles')
const initialCycle = cycles.value?.find(cycle => cycle.active) || cycles.value?.[0]
const selectedCycleId = ref(initialCycle?._id || '')
const cycleItems = computed<SelectItem[]>(() =>
  (cycles.value || []).map(cycle => ({ label: `${cycle.year} — ${cycle.name}`, value: cycle._id }))
)

watch(cycles, (value) => {
  if (!selectedCycleId.value) {
    selectedCycleId.value = value?.find(cycle => cycle.active)?._id || value?.[0]?._id || ''
  }
})

const requestFetch = useRequestFetch()
const { data: dashboard, status } = useAsyncData<DashboardSummary | null>(
  'dashboard-summary',
  () => selectedCycleId.value
    ? requestFetch<DashboardSummary>('/api/dashboard', { query: { cycleId: selectedCycleId.value } })
    : Promise.resolve(null),
  { watch: [selectedCycleId] }
)

const mappedPercent = computed(() => {
  const totals = dashboard.value?.totals
  return totals?.submissions ? Math.round((totals.mapped / totals.submissions) * 100) : 0
})

const reviewCompletionPercent = computed(() => {
  const totals = dashboard.value?.totals
  return totals?.totalReviews ? Math.round((totals.completedReviews / totals.totalReviews) * 100) : 0
})

function formatJobType(type: string) {
  return type.replaceAll('_', ' ').replace(/\b\w/g, character => character.toUpperCase())
}

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString() : '—'
}

function statusColor(jobStatus: string) {
  if (jobStatus === 'completed') return 'success'
  if (jobStatus === 'failed') return 'error'
  if (['pending', 'waiting', 'running'].includes(jobStatus)) return 'warning'
  return 'neutral'
}
</script>

<template>
  <UContainer class="py-8 space-y-6">
    <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 class="text-2xl font-semibold">
          Dashboard
        </h1>
        <p class="mt-1 text-sm text-muted">
          Admissions pipeline status for the selected cycle.
        </p>
      </div>
      <UFormField label="Admission cycle" class="w-full sm:w-72">
        <USelect v-model="selectedCycleId" :items="cycleItems" placeholder="Select a cycle" class="w-full" />
      </UFormField>
    </div>

    <div v-if="status === 'pending'" class="py-12 text-center text-muted">
      Loading dashboard...
    </div>

    <UAlert
      v-else-if="!selectedCycleId"
      title="No admission cycle available"
      description="Create a cycle to begin tracking the admissions pipeline."
      color="warning"
      variant="soft"
    />

    <template v-else-if="dashboard">
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <UCard v-for="application in dashboard.byApplication" :key="application.applicationId">
          <p class="truncate text-sm text-muted">
            {{ application.name }}
          </p>
          <p class="mt-2 text-3xl font-semibold">
            {{ application.total.toLocaleString() }}
          </p>
          <p class="mt-2 text-sm text-muted">
            {{ application.mapped.toLocaleString() }} mapped · {{ application.completed.toLocaleString() }} completed
          </p>
        </UCard>

        <UCard>
          <p class="text-sm text-muted">
            Total submissions
          </p>
          <p class="mt-2 text-3xl font-semibold">
            {{ dashboard.totals.submissions.toLocaleString() }}
          </p>
          <p class="mt-2 text-sm text-muted">
            {{ mappedPercent }}% mapped · {{ dashboard.totals.applications.toLocaleString() }} active applications
          </p>
        </UCard>

        <UCard>
          <p class="text-sm text-muted">
            Active jobs
          </p>
          <p class="mt-2 text-3xl font-semibold">
            {{ dashboard.totals.activeJobs.toLocaleString() }}
          </p>
          <UButton to="/jobs" label="View jobs" color="neutral" variant="link" class="mt-2 p-0" />
        </UCard>

        <UCard>
          <p class="text-sm text-muted">
            Open validation issues
          </p>
          <p class="mt-2 text-3xl font-semibold">
            {{ dashboard.totals.openIssues.toLocaleString() }}
          </p>
          <UButton to="/validation" label="View issues" color="neutral" variant="link" class="mt-2 p-0" />
        </UCard>
      </div>

      <DashboardApplicationSection
        v-for="application in dashboard.applications"
        :key="application.applicationId"
        :application="application"
      />

      <div class="space-y-4 border-t border-default pt-6">
        <h2 class="text-lg font-semibold">
          Operations
        </h2>
        <div class="grid gap-6 xl:grid-cols-3">
          <UCard>
            <template #header>
              <h3 class="font-semibold">
                Submission status
              </h3>
            </template>
            <div v-if="dashboard.byStatus.length" class="space-y-3">
              <div v-for="item in dashboard.byStatus" :key="item.name" class="flex items-center justify-between gap-4">
                <span class="truncate text-sm">{{ item.name }}</span>
                <UBadge :label="item.total.toLocaleString()" color="neutral" variant="soft" />
              </div>
            </div>
            <p v-else class="text-sm text-muted">
              No status data available.
            </p>
          </UCard>

          <UCard>
            <template #header>
              <h3 class="font-semibold">
                Open issues by severity
              </h3>
            </template>
            <div v-if="dashboard.bySeverity.length" class="space-y-3">
              <div v-for="item in dashboard.bySeverity" :key="item.name" class="flex items-center justify-between gap-4">
                <span class="truncate text-sm capitalize">{{ item.name }}</span>
                <UBadge :label="item.total.toLocaleString()" color="neutral" variant="soft" />
              </div>
            </div>
            <p v-else class="text-sm text-muted">
              No open validation issues.
            </p>
          </UCard>

          <UCard>
            <template #header>
              <h3 class="font-semibold">
                Reviews submitted
              </h3>
            </template>
            <div class="mt-1 flex items-end justify-between gap-4">
              <p class="text-3xl font-semibold">
                {{ reviewCompletionPercent }}%
              </p>
              <p class="text-sm text-muted">
                {{ dashboard.totals.completedReviews.toLocaleString() }} / {{ dashboard.totals.totalReviews.toLocaleString() }} complete
              </p>
            </div>
            <UProgress :model-value="reviewCompletionPercent" :max="100" size="sm" class="mt-3" />
          </UCard>
        </div>

        <UCard :ui="{ body: 'p-0 sm:p-0' }">
          <template #header>
            <h3 class="font-semibold">
              Review stages
            </h3>
          </template>
          <div v-if="dashboard.byReviewStage.length" class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-muted/50 text-left">
                <tr>
                  <th class="p-3 font-medium">
                    Stage
                  </th>
                  <th class="p-3 text-right font-medium">
                    Total
                  </th>
                  <th class="p-3 text-right font-medium">
                    Completed
                  </th>
                  <th class="p-3 text-right font-medium">
                    %
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in dashboard.byReviewStage" :key="item.name" class="border-t">
                  <td class="p-3">
                    {{ item.name }}
                  </td>
                  <td class="p-3 text-right">
                    {{ item.total.toLocaleString() }}
                  </td>
                  <td class="p-3 text-right">
                    {{ item.completed.toLocaleString() }}
                  </td>
                  <td class="p-3 text-right">
                    {{ item.percent }}%
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="p-6 text-center text-sm text-muted">
            No review data available.
          </p>
        </UCard>

        <UCard :ui="{ body: 'p-0 sm:p-0' }">
          <template #header>
            <div class="flex items-center justify-between">
              <div>
                <h3 class="font-semibold">
                  Recent jobs
                </h3>
                <p class="text-sm text-muted">
                  Latest pipeline activity for this cycle.
                </p>
              </div>
              <UButton to="/jobs" label="View all jobs" color="neutral" variant="outline" size="sm" />
            </div>
          </template>

          <div v-if="dashboard.recentJobs.length" class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-muted/50 text-left">
                <tr>
                  <th class="p-3 font-medium">
                    Job
                  </th>
                  <th class="p-3 font-medium">
                    Status
                  </th>
                  <th class="p-3 font-medium">
                    Progress
                  </th>
                  <th class="p-3 font-medium">
                    Started
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="job in dashboard.recentJobs" :key="job._id" class="border-t">
                  <td class="p-3 font-medium">
                    {{ formatJobType(job.type) }}
                  </td>
                  <td class="p-3">
                    <UBadge :label="job.status" :color="statusColor(job.status)" variant="soft" />
                  </td>
                  <td class="min-w-56 p-3">
                    <UProgress v-if="job.progress" :model-value="job.progress.percent || 0" :max="100" size="xs" />
                    <span v-else class="text-muted">—</span>
                  </td>
                  <td class="p-3 text-muted">
                    {{ formatDate(job.startedAt || job.createdAt) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="p-6 text-center text-sm text-muted">
            No jobs have been run for this cycle.
          </p>
        </UCard>
      </div>
    </template>
  </UContainer>
</template>
