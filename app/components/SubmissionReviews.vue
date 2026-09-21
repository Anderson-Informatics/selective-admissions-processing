<script setup lang="ts">
interface Review {
  _id: string
  stageName: string
  stageOrder: number
  requiredForProgress: boolean
  reviewerId?: string
  score?: number
  isAssigned?: boolean
  completedAt?: string
  createdBy?: string
  status: string
  mappedData: Record<string, any>
}

const props = defineProps<{
  cycleId: string
  submissionId: string
}>()

const url = computed(() =>
  `/api/submissions/${encodeURIComponent(props.submissionId)}/reviews?cycleId=${encodeURIComponent(props.cycleId)}`
)

const { data, status, error } = useFetch<{ reviews: Review[] }>(url)

const reviewFieldEntries = (review: Review) =>
  Object.entries(review.mappedData || {}).sort(([a], [b]) => a.localeCompare(b))
</script>

<template>
  <div class="py-3 px-4 bg-muted/30 border-t">
    <div v-if="status === 'pending'" class="text-sm text-muted">
      Loading reviews...
    </div>
    <div v-else-if="error" class="text-sm text-error">
      Failed to load reviews.
    </div>
    <div v-else-if="!data?.reviews.length" class="text-sm text-muted">
      No completed reviews for this submission.
    </div>
    <div v-else class="space-y-4">
      <div v-for="review in data.reviews" :key="review._id" class="bg-white dark:bg-neutral-900 border rounded-lg p-4">
        <div class="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3 text-sm">
          <span class="font-medium">{{ review.stageName || 'Review' }}</span>
          <span class="text-muted">Status: {{ review.status }}</span>
          <span v-if="review.reviewerId" class="text-muted">Reviewer: {{ review.reviewerId }}</span>
          <span v-if="review.createdBy" class="text-muted">Created by: {{ review.createdBy }}</span>
          <span v-if="review.score !== undefined" class="text-muted">Score: {{ review.score }}</span>
          <span v-if="review.isAssigned !== undefined" class="text-muted">Assigned: {{ review.isAssigned ? 'Yes' : 'No' }}</span>
          <span v-if="review.completedAt" class="text-muted">Completed: {{ new Date(review.completedAt).toLocaleString() }}</span>
        </div>

        <div v-if="reviewFieldEntries(review).length" class="max-h-48 overflow-y-auto border rounded">
          <table class="w-full text-sm">
            <thead class="bg-muted text-left sticky top-0">
              <tr>
                <th class="p-2 font-medium">
                  Field
                </th>
                <th class="p-2 font-medium">
                  Value
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="[key, value] in reviewFieldEntries(review)" :key="key" class="border-t">
                <td class="p-2 font-medium">
                  {{ key }}
                </td>
                <td class="p-2 text-muted whitespace-pre-wrap">
                  {{ value }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="text-sm text-muted">
          No mapped fields for this review.
        </div>
      </div>
    </div>
  </div>
</template>
