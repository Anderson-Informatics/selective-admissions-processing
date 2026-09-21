<script setup lang="ts">
import { h, resolveComponent } from 'vue'
import type { SelectItem, TableColumn } from '@nuxt/ui'

interface Cycle {
  _id: string
  year: string
  name: string
  active: boolean
}

interface HSPTResult {
  _id: string
  sourceId: string
  resultId?: number
  hpid: string
  testCenter: string
  batch: string
  lastName: string
  firstName: string
  birth: string
  optCd: string
  reading: number
  math: number
  language: number
  science: number
  overall: number
  status: 'unlinked' | 'linked' | 'rejected'
  matchType?: string
  matchScore?: number
  linkedSubmissionId?: string
  submission?: {
    submissionId: string
    submissionIdInt?: number
    mappedFields: {
      FullName?: string
      FirstName?: string
      LastName?: string
      DOB?: string
      StudentNumber?: string
    }
  }
}

interface Applicant {
  submissionId: string
  submissionIdInt?: number
  fullName: string
  firstName: string
  lastName: string
}

const toast = useToast()
const { data: cycles } = await useFetch<Cycle[]>('/api/cycles')
const selectedCycleId = ref('')

watchEffect(() => {
  const active = cycles.value?.find(c => c.active)
  if (active && !selectedCycleId.value) {
    selectedCycleId.value = active._id
  }
})

const selectedStatus = ref('all')
const search = ref('')
const page = ref(1)
const limit = 25
const rowSelection = ref<Record<string, boolean>>({})
const bulkLoading = ref(false)

const statusItems: SelectItem[] = [
  { label: 'All', value: 'all' },
  { label: 'Unlinked', value: 'unlinked' },
  { label: 'Linked', value: 'linked' },
  { label: 'Needs Review', value: 'needs-review' },
  { label: 'Rejected', value: 'rejected' }
]

watch([selectedCycleId, selectedStatus, search], () => {
  page.value = 1
  rowSelection.value = {}
  refresh()
})

watch(page, () => {
  rowSelection.value = {}
})

const requestFetch = useRequestFetch()
const { data, status, refresh } = useAsyncData<{
  results: HSPTResult[]
  total: number
  page: number
  limit: number
}>(
  'hspt-results',
  () => {
    if (!selectedCycleId.value) {
      return Promise.resolve({ results: [], total: 0, page: 1, limit })
    }
    const params = new URLSearchParams()
    params.set('cycleId', selectedCycleId.value)
    params.set('page', String(page.value))
    params.set('limit', String(limit))
    if (selectedStatus.value === 'needs-review') {
      params.set('needsReview', 'true')
    } else if (selectedStatus.value !== 'all') {
      params.set('status', selectedStatus.value)
    }
    const q = search.value.trim()
    if (q) params.set('q', q)
    return requestFetch(`/api/hspt?${params.toString()}`)
  },
  {
    default: () => ({ results: [], total: 0, page: 1, limit }),
    watch: [selectedCycleId, selectedStatus, search, page]
  }
)

const totalPages = computed(() => Math.ceil((data.value?.total || 0) / limit))

interface ApplicantItem {
  label: string
  submissionId: string
}

const applicantItems = ref<ApplicantItem[]>([])
const applicantsLoading = ref(false)
let applicantSearchTimer: ReturnType<typeof setTimeout> | null = null
let applicantSearchRequest = 0

function toApplicantItem(applicant: Applicant): ApplicantItem {
  return {
    label: `${applicant.fullName} (${applicant.submissionIdInt ?? 'ID unavailable'})`,
    submissionId: applicant.submissionId
  }
}

function searchApplicants(searchTerm: string) {
  if (applicantSearchTimer) clearTimeout(applicantSearchTimer)
  const requestId = ++applicantSearchRequest
  const selected = applicantItems.value.find(item => item.submissionId === manualSubmissionId.value)
  const query = searchTerm.trim()
  if (query.length < 2 || !selectedCycleId.value) {
    applicantItems.value = selected ? [selected] : []
    applicantsLoading.value = false
    return
  }

  applicantsLoading.value = true
  applicantSearchTimer = setTimeout(async () => {
    try {
      const results = await $fetch<Applicant[]>('/api/hspt/unlinked-submissions', {
        query: { cycleId: selectedCycleId.value, q: query, limit: 50 }
      })
      if (requestId !== applicantSearchRequest) return
      const items = results.map(toApplicantItem)
      applicantItems.value = selected && !items.some(item => item.submissionId === selected.submissionId)
        ? [selected, ...items]
        : items
    } catch (error: unknown) {
      if (requestId === applicantSearchRequest) {
        const message = (error as { data?: { statusMessage?: string } }).data?.statusMessage || 'Applicant search failed'
        toast.add({ title: message, color: 'error' })
      }
    } finally {
      if (requestId === applicantSearchRequest) applicantsLoading.value = false
    }
  }, 250)
}

const linkModalOpen = ref(false)
const unlinkModalOpen = ref(false)
const selectedResult = ref<HSPTResult | null>(null)
const selectedUnlinkResult = ref<HSPTResult | null>(null)
const manualSubmissionId = ref('')
const actionLoading = ref<Set<string>>(new Set())

function openLinkModal(result: HSPTResult) {
  selectedResult.value = result
  manualSubmissionId.value = result.linkedSubmissionId || ''
  applicantItems.value = result.linkedSubmissionId
    ? [{
        label: `${result.submission?.mappedFields?.FullName || 'Applicant'} (${result.submission?.submissionIdInt ?? 'ID unavailable'})`,
        submissionId: result.linkedSubmissionId
      }]
    : []
  applicantsLoading.value = false
  linkModalOpen.value = true
}

async function onManualLink() {
  if (!selectedResult.value || !manualSubmissionId.value) return
  actionLoading.value.add(selectedResult.value._id)
  try {
    await $fetch(`/api/hspt/${selectedResult.value._id}/link`, { method: 'POST', body: { submissionId: manualSubmissionId.value } })
    toast.add({ title: 'HSPT result linked', color: 'success' })
    linkModalOpen.value = false
    await refresh()
  } catch (error: unknown) {
    const message = (error as { data?: { statusMessage?: string } }).data?.statusMessage || 'Failed to link'
    toast.add({ title: message, color: 'error' })
  } finally {
    actionLoading.value.delete(selectedResult.value._id)
  }
}

async function acceptFuzzy(resultId: string) {
  actionLoading.value.add(resultId)
  try {
    await $fetch(`/api/hspt/${resultId}/link`, { method: 'POST', body: {} })
    toast.add({ title: 'Fuzzy match accepted', color: 'success' })
    await refresh()
  } catch (error: unknown) {
    const message = (error as { data?: { statusMessage?: string } }).data?.statusMessage || 'Failed to accept'
    toast.add({ title: message, color: 'error' })
  } finally {
    actionLoading.value.delete(resultId)
  }
}

async function rejectFuzzy(resultId: string) {
  actionLoading.value.add(resultId)
  try {
    await $fetch(`/api/hspt/${resultId}/reject`, { method: 'POST' })
    toast.add({ title: 'Fuzzy match rejected', color: 'success' })
    await refresh()
  } catch (error: unknown) {
    const message = (error as { data?: { statusMessage?: string } }).data?.statusMessage || 'Failed to reject'
    toast.add({ title: message, color: 'error' })
  } finally {
    actionLoading.value.delete(resultId)
  }
}

function openUnlinkModal(result: HSPTResult) {
  selectedUnlinkResult.value = result
  unlinkModalOpen.value = true
}

async function confirmUnlink() {
  if (!selectedUnlinkResult.value) return
  const resultId = selectedUnlinkResult.value._id
  actionLoading.value.add(resultId)
  try {
    await $fetch(`/api/hspt/${resultId}/unlink`, { method: 'POST' })
    toast.add({ title: 'HSPT result unlinked', color: 'success' })
    unlinkModalOpen.value = false
    selectedUnlinkResult.value = null
    await refresh()
  } catch (error: unknown) {
    const message = (error as { data?: { statusMessage?: string } }).data?.statusMessage || 'Failed to unlink'
    toast.add({ title: message, color: 'error' })
  } finally {
    actionLoading.value.delete(resultId)
  }
}

async function runBulkAction(action: 'accept' | 'reject') {
  const resultIds = Object.entries(rowSelection.value)
    .filter(([, selected]) => selected)
    .map(([id]) => id)
  if (!resultIds.length || !selectedCycleId.value) return

  bulkLoading.value = true
  try {
    const result = await $fetch<{ processed: number, skipped: number }>('/api/hspt/bulk-action', {
      method: 'POST',
      body: { cycleId: selectedCycleId.value, action, resultIds }
    })
    toast.add({
      title: `${result.processed} match${result.processed === 1 ? '' : 'es'} ${action === 'accept' ? 'accepted' : 'rejected'}`,
      description: result.skipped ? `${result.skipped} ineligible selection${result.skipped === 1 ? '' : 's'} skipped` : undefined,
      color: 'success'
    })
    rowSelection.value = {}
    await refresh()
  } catch (error: unknown) {
    const message = (error as { data?: { statusMessage?: string } }).data?.statusMessage || `Failed to ${action} selected matches`
    toast.add({ title: message, color: 'error' })
  } finally {
    bulkLoading.value = false
  }
}

interface UploadSummary {
  processed: number
  valid?: number
  invalid?: number
  inserted?: number
  updated?: number
  errors: string[]
  matching?: {
    exact?: number
    fuzzy?: number
    unmatched?: number
    linked?: number
    needsReview?: number
    unlinked?: number
    byType?: Record<string, number>
  }
}

interface UploadStatusResponse {
  upload: {
    status: 'previewing' | 'ready' | 'confirming' | 'completed' | 'failed' | 'cancelled'
    preview?: UploadSummary
    result?: UploadSummary
    error?: string
  }
  job?: {
    status: 'pending' | 'running' | 'completed' | 'failed'
    progress?: { percent?: number, message?: string }
    error?: string
  }
}

const uploadModalOpen = ref(false)
const uploadStage = ref<'select' | 'previewing' | 'review' | 'importing' | 'complete' | 'failed'>('select')
const uploadFiles = ref<File[]>([])
const uploadId = ref('')
const uploadProgress = ref(0)
const uploadMessage = ref('')
const uploadPreview = ref<UploadSummary | null>(null)
const uploadResult = ref<UploadSummary | null>(null)
const uploadError = ref('')
let uploadPollTimer: ReturnType<typeof setTimeout> | null = null

const uploadProcessing = computed(() => ['previewing', 'importing'].includes(uploadStage.value))

function clearUploadPoll() {
  if (uploadPollTimer) clearTimeout(uploadPollTimer)
  uploadPollTimer = null
}

function openUploadModal() {
  clearUploadPoll()
  uploadStage.value = 'select'
  uploadFiles.value = []
  uploadId.value = ''
  uploadProgress.value = 0
  uploadMessage.value = ''
  uploadPreview.value = null
  uploadResult.value = null
  uploadError.value = ''
  uploadModalOpen.value = true
}

function selectUploadFiles(event: Event) {
  uploadFiles.value = [...((event.target as HTMLInputElement).files || [])]
}

async function pollUpload() {
  if (!uploadId.value) return
  try {
    const response = await $fetch<UploadStatusResponse>(`/api/hspt/uploads/${uploadId.value}`)
    uploadProgress.value = response.job?.progress?.percent || 0
    uploadMessage.value = response.job?.progress?.message || ''

    if (response.upload.status === 'ready') {
      uploadPreview.value = response.upload.preview || null
      uploadStage.value = 'review'
      return
    }
    if (response.upload.status === 'completed') {
      uploadResult.value = response.upload.result || null
      uploadProgress.value = 100
      uploadStage.value = 'complete'
      await refresh()
      return
    }
    if (response.upload.status === 'failed' || response.job?.status === 'failed') {
      uploadError.value = response.upload.error || response.job?.error || 'HSPT processing failed'
      uploadStage.value = 'failed'
      return
    }

    uploadPollTimer = setTimeout(pollUpload, 1000)
  } catch (error: unknown) {
    uploadError.value = (error as { data?: { statusMessage?: string } }).data?.statusMessage || 'Failed to check upload progress'
    uploadStage.value = 'failed'
  }
}

async function startUploadPreview() {
  if (!uploadFiles.value.length || !selectedCycleId.value) return
  const formData = new FormData()
  formData.set('cycleId', selectedCycleId.value)
  for (const file of uploadFiles.value) formData.append('files', file)

  uploadStage.value = 'previewing'
  uploadProgress.value = 0
  uploadMessage.value = 'Uploading CSV files'
  try {
    const response = await $fetch<{ uploadId: string }>('/api/hspt/uploads', { method: 'POST', body: formData })
    uploadId.value = response.uploadId
    await pollUpload()
  } catch (error: unknown) {
    uploadError.value = (error as { data?: { statusMessage?: string } }).data?.statusMessage || 'Failed to start upload preview'
    uploadStage.value = 'failed'
  }
}

async function confirmUpload() {
  if (!uploadId.value) return
  uploadStage.value = 'importing'
  uploadProgress.value = 0
  uploadMessage.value = 'Queueing confirmed import'
  try {
    await $fetch(`/api/hspt/uploads/${uploadId.value}/confirm`, { method: 'POST' })
    await pollUpload()
  } catch (error: unknown) {
    uploadError.value = (error as { data?: { statusMessage?: string } }).data?.statusMessage || 'Failed to confirm upload'
    uploadStage.value = 'failed'
  }
}

async function cancelUpload() {
  clearUploadPoll()
  if (uploadId.value && uploadStage.value === 'review') {
    await $fetch(`/api/hspt/uploads/${uploadId.value}/cancel`, { method: 'POST' }).catch(() => undefined)
  }
  uploadModalOpen.value = false
}

async function finishUpload() {
  clearUploadPoll()
  uploadModalOpen.value = false
  await refresh()
}

onBeforeUnmount(() => {
  clearUploadPoll()
  if (applicantSearchTimer) clearTimeout(applicantSearchTimer)
})

const UCheckbox = resolveComponent('UCheckbox')
const selectedCount = computed(() => Object.values(rowSelection.value).filter(Boolean).length)

const selectColumn: TableColumn<HSPTResult> = {
  id: 'select',
  header: ({ table }) => h(UCheckbox, {
    'modelValue': table.getIsSomePageRowsSelected() ? 'indeterminate' : table.getIsAllPageRowsSelected(),
    'onUpdate:modelValue': (value: boolean | 'indeterminate') => table.toggleAllPageRowsSelected(!!value),
    'aria-label': 'Select all results on this page'
  }),
  cell: ({ row }) => h(UCheckbox, {
    'modelValue': row.getIsSelected(),
    'onUpdate:modelValue': (value: boolean | 'indeterminate') => row.toggleSelected(!!value),
    'aria-label': `Select ${row.original.firstName} ${row.original.lastName}`
  }),
  enableSorting: false,
  enableHiding: false
}

const resultColumns: TableColumn<HSPTResult>[] = [
  { id: 'resultId', accessorKey: 'resultId', header: 'Result ID' },
  { id: 'lastName', accessorKey: 'lastName', header: 'Last' },
  { id: 'firstName', accessorKey: 'firstName', header: 'First' },
  { id: 'birth', accessorKey: 'birth', header: 'Birth' },
  { id: 'optCd', accessorKey: 'optCd', header: 'OptCd' },
  { id: 'batch', accessorKey: 'batch', header: 'Batch' },
  { id: 'overall', accessorFn: row => row.overall.toFixed(2), header: 'Overall' },
  { id: 'match', header: 'Match', enableSorting: false },
  { id: 'status', accessorKey: 'status', header: 'Status' },
  { id: 'actions', header: 'Actions', enableSorting: false }
]

const columns = computed<TableColumn<HSPTResult>[]>(() => selectedStatus.value === 'needs-review'
  ? [selectColumn, ...resultColumns]
  : resultColumns)
</script>

<template>
  <UContainer class="py-8">
    <h1 class="text-2xl font-semibold mb-6">
      HSPT Upload & Matching
    </h1>

    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <UFormField label="Cycle">
        <USelect
          v-model="selectedCycleId"
          :items="(cycles || []).map(c => ({ label: `${c.year} — ${c.name}`, value: c._id }))"
          placeholder="Select a cycle"
          class="w-full"
        />
      </UFormField>

      <UFormField label="Status">
        <USelect
          v-model="selectedStatus"
          :items="statusItems"
          class="w-full"
        />
      </UFormField>

      <UFormField label="Search">
        <UInput
          v-model="search"
          placeholder="Name or DOB"
          class="w-full"
        />
      </UFormField>

      <UFormField label="HSPT Data">
        <UButton
          label="Upload HSPT CSV"
          icon="i-lucide-upload"
          :disabled="!selectedCycleId"
          @click="openUploadModal"
        />
      </UFormField>
    </div>

    <div
      v-if="selectedStatus === 'needs-review'"
      class="flex items-center gap-2 mb-3"
    >
      <span class="text-sm text-muted">{{ selectedCount }} selected</span>
      <UButton
        label="Accept Selected"
        color="success"
        size="sm"
        :disabled="selectedCount === 0"
        :loading="bulkLoading"
        @click="runBulkAction('accept')"
      />
      <UButton
        label="Reject Selected"
        color="error"
        variant="outline"
        size="sm"
        :disabled="selectedCount === 0"
        :loading="bulkLoading"
        @click="runBulkAction('reject')"
      />
    </div>

    <p class="text-sm text-muted mb-2">
      Showing {{ data?.results.length || 0 }} of {{ data?.total || 0 }} results
    </p>

    <UTable
      v-model:row-selection="rowSelection"
      :data="data?.results || []"
      :columns="columns"
      :get-row-id="row => row._id"
      :loading="status === 'pending'"
      empty="No HSPT results. Upload a CSV to get started."
      class="border rounded-lg mb-4"
    >
      <template #match-cell="{ row }">
        <UPopover
          v-if="row.original.linkedSubmissionId"
          mode="hover"
          enable-touch
          :open-delay="200"
        >
          <div class="text-sm cursor-help">
            <span class="font-medium underline decoration-dotted underline-offset-2">{{ row.original.submission?.mappedFields?.FullName || 'Potential match' }}</span>
            <br>
            <span class="text-xs text-muted">{{ row.original.matchType }}{{ row.original.matchScore !== undefined ? ` (${row.original.matchScore.toFixed(2)})` : '' }}</span>
          </div>

          <template #content>
            <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 p-4 text-sm min-w-72">
              <dt class="text-muted">
                Submission ID
              </dt>
              <dd>{{ row.original.submission?.submissionIdInt ?? '—' }}</dd>
              <dt class="text-muted">
                Student number
              </dt>
              <dd>{{ row.original.submission?.mappedFields?.StudentNumber || '—' }}</dd>
              <dt class="text-muted">
                Full name
              </dt>
              <dd>{{ row.original.submission?.mappedFields?.FullName || '—' }}</dd>
              <dt class="text-muted">
                First name
              </dt>
              <dd>{{ row.original.submission?.mappedFields?.FirstName || '—' }}</dd>
              <dt class="text-muted">
                Last name
              </dt>
              <dd>{{ row.original.submission?.mappedFields?.LastName || '—' }}</dd>
              <dt class="text-muted">
                DOB
              </dt>
              <dd>{{ row.original.submission?.mappedFields?.DOB || '—' }}</dd>
            </dl>
          </template>
        </UPopover>
        <span
          v-else
          class="text-sm text-muted"
        >—</span>
      </template>

      <template #status-cell="{ row }">
        <UBadge
          :label="row.original.status"
          :color="row.original.status === 'linked' ? 'success' : row.original.status === 'rejected' ? 'neutral' : 'warning'"
          variant="subtle"
        />
      </template>

      <template #actions-cell="{ row }">
        <div class="flex gap-1">
          <UButton
            v-if="row.original.status === 'unlinked' && row.original.matchType"
            size="xs"
            color="success"
            label="Accept"
            :loading="actionLoading.has(row.original._id)"
            @click="acceptFuzzy(row.original._id)"
          />
          <UButton
            v-if="row.original.status === 'unlinked'"
            size="xs"
            color="neutral"
            variant="outline"
            label="Link"
            :loading="actionLoading.has(row.original._id)"
            @click="openLinkModal(row.original)"
          />
          <UButton
            v-if="row.original.status === 'unlinked' && row.original.matchType"
            size="xs"
            color="error"
            variant="outline"
            label="Reject"
            :loading="actionLoading.has(row.original._id)"
            @click="rejectFuzzy(row.original._id)"
          />
          <UButton
            v-if="row.original.status === 'linked'"
            size="xs"
            color="neutral"
            variant="outline"
            label="Unlink"
            :loading="actionLoading.has(row.original._id)"
            @click="openUnlinkModal(row.original)"
          />
        </div>
      </template>
    </UTable>

    <div
      v-if="data?.results.length"
      class="flex items-center justify-between"
    >
      <UButton
        color="neutral"
        variant="outline"
        :disabled="page <= 1"
        @click="page--"
      >
        Previous
      </UButton>
      <span class="text-sm text-muted">
        Page {{ data.page }} of {{ totalPages }}
      </span>
      <UButton
        color="neutral"
        variant="outline"
        :disabled="page >= totalPages"
        @click="page++"
      >
        Next
      </UButton>
    </div>

    <UModal
      v-model:open="uploadModalOpen"
      title="Upload HSPT CSV"
      description="Preview and confirm HSPT data before it is imported."
      :dismissible="!uploadProcessing"
    >
      <template #body>
        <div
          v-if="uploadStage === 'select'"
          class="space-y-4"
        >
          <UFormField
            label="CSV files"
            description="Select one or more CSV files, up to 8 MB total."
          >
            <UInput
              type="file"
              accept=".csv"
              multiple
              class="w-full"
              @change="selectUploadFiles"
            />
          </UFormField>
          <ul
            v-if="uploadFiles.length"
            class="space-y-1 text-sm text-muted"
          >
            <li
              v-for="file in uploadFiles"
              :key="`${file.name}-${file.size}`"
            >
              {{ file.name }} ({{ Math.ceil(file.size / 1024).toLocaleString() }} KB)
            </li>
          </ul>
        </div>

        <div
          v-else-if="uploadProcessing"
          class="space-y-3 py-4"
        >
          <UProgress
            :model-value="uploadProgress"
            :max="100"
            size="md"
          />
          <p class="text-sm text-muted">
            {{ uploadMessage || (uploadStage === 'previewing' ? 'Preparing preview' : 'Importing HSPT data') }}
          </p>
          <p class="text-sm font-medium">
            {{ uploadProgress }}%
          </p>
        </div>

        <div
          v-else-if="uploadStage === 'review' && uploadPreview"
          class="space-y-4"
        >
          <UAlert
            title="Preview ready"
            description="Review these results before confirming. No HSPT records have been changed yet."
            color="info"
            variant="subtle"
          />
          <dl class="grid grid-cols-2 gap-3 text-sm">
            <div class="rounded-md bg-elevated p-3">
              <dt class="text-muted">
                Rows processed
              </dt>
              <dd class="text-lg font-semibold">
                {{ uploadPreview.processed.toLocaleString() }}
              </dd>
            </div>
            <div class="rounded-md bg-elevated p-3">
              <dt class="text-muted">
                Valid rows
              </dt>
              <dd class="text-lg font-semibold">
                {{ (uploadPreview.valid || 0).toLocaleString() }}
              </dd>
            </div>
            <div class="rounded-md bg-elevated p-3">
              <dt class="text-muted">
                Invalid rows
              </dt>
              <dd class="text-lg font-semibold">
                {{ (uploadPreview.invalid || 0).toLocaleString() }}
              </dd>
            </div>
            <div class="rounded-md bg-elevated p-3">
              <dt class="text-muted">
                Files
              </dt>
              <dd class="text-lg font-semibold">
                {{ uploadFiles.length }}
              </dd>
            </div>
          </dl>
          <div
            v-if="uploadPreview.matching"
            class="space-y-3"
          >
            <h3 class="text-sm font-medium">
              Predicted matching results
            </h3>
            <dl class="grid grid-cols-3 gap-3 text-sm">
              <div class="rounded-md bg-elevated p-3">
                <dt class="text-muted">
                  Linked
                </dt>
                <dd class="text-lg font-semibold">
                  {{ (uploadPreview.matching.linked || 0).toLocaleString() }}
                </dd>
              </div>
              <div class="rounded-md bg-elevated p-3">
                <dt class="text-muted">
                  Needs review
                </dt>
                <dd class="text-lg font-semibold">
                  {{ (uploadPreview.matching.needsReview || 0).toLocaleString() }}
                </dd>
              </div>
              <div class="rounded-md bg-elevated p-3">
                <dt class="text-muted">
                  Unlinked
                </dt>
                <dd class="text-lg font-semibold">
                  {{ (uploadPreview.matching.unlinked || 0).toLocaleString() }}
                </dd>
              </div>
            </dl>
            <div
              v-if="Object.keys(uploadPreview.matching.byType || {}).length"
              class="rounded-md border p-3"
            >
              <p class="text-sm font-medium mb-2">
                Match types
              </p>
              <dl class="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
                <template
                  v-for="(count, matchType) in uploadPreview.matching.byType"
                  :key="matchType"
                >
                  <dt class="text-muted">
                    {{ matchType }}
                  </dt>
                  <dd class="font-medium text-right">
                    {{ count.toLocaleString() }}
                  </dd>
                </template>
              </dl>
            </div>
          </div>
          <div v-if="uploadPreview.errors.length">
            <p class="text-sm font-medium mb-2">
              Preview errors
            </p>
            <ul class="max-h-40 overflow-y-auto rounded-md border p-3 text-sm text-error space-y-1">
              <li
                v-for="error in uploadPreview.errors"
                :key="error"
              >
                {{ error }}
              </li>
            </ul>
          </div>
        </div>

        <div
          v-else-if="uploadStage === 'complete' && uploadResult"
          class="space-y-4"
        >
          <UAlert
            title="Import complete"
            description="The HSPT records were imported and matching has finished."
            color="success"
            variant="subtle"
          />
          <dl class="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            <div class="rounded-md bg-elevated p-3">
              <dt class="text-muted">
                Processed
              </dt><dd class="text-lg font-semibold">
                {{ uploadResult.processed.toLocaleString() }}
              </dd>
            </div>
            <div class="rounded-md bg-elevated p-3">
              <dt class="text-muted">
                Inserted
              </dt><dd class="text-lg font-semibold">
                {{ (uploadResult.inserted || 0).toLocaleString() }}
              </dd>
            </div>
            <div class="rounded-md bg-elevated p-3">
              <dt class="text-muted">
                Updated
              </dt><dd class="text-lg font-semibold">
                {{ (uploadResult.updated || 0).toLocaleString() }}
              </dd>
            </div>
            <div class="rounded-md bg-elevated p-3">
              <dt class="text-muted">
                Exact matches
              </dt><dd class="text-lg font-semibold">
                {{ (uploadResult.matching?.exact || 0).toLocaleString() }}
              </dd>
            </div>
            <div class="rounded-md bg-elevated p-3">
              <dt class="text-muted">
                Needs review
              </dt><dd class="text-lg font-semibold">
                {{ (uploadResult.matching?.fuzzy || 0).toLocaleString() }}
              </dd>
            </div>
            <div class="rounded-md bg-elevated p-3">
              <dt class="text-muted">
                Unmatched
              </dt><dd class="text-lg font-semibold">
                {{ (uploadResult.matching?.unmatched || 0).toLocaleString() }}
              </dd>
            </div>
          </dl>
          <div v-if="uploadResult.errors.length">
            <p class="text-sm font-medium mb-2">
              Import errors
            </p>
            <ul class="max-h-40 overflow-y-auto rounded-md border p-3 text-sm text-error space-y-1">
              <li
                v-for="error in uploadResult.errors"
                :key="error"
              >
                {{ error }}
              </li>
            </ul>
          </div>
        </div>

        <UAlert
          v-else-if="uploadStage === 'failed'"
          title="Upload failed"
          :description="uploadError"
          color="error"
          variant="subtle"
        />
      </template>

      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <template v-if="uploadStage === 'select'">
            <UButton
              label="Cancel"
              color="neutral"
              variant="outline"
              @click="cancelUpload"
            />
            <UButton
              label="Start Preview"
              :disabled="!uploadFiles.length"
              @click="startUploadPreview"
            />
          </template>
          <template v-else-if="uploadStage === 'review'">
            <UButton
              label="Cancel Import"
              color="neutral"
              variant="outline"
              @click="cancelUpload"
            />
            <UButton
              label="Confirm Import"
              color="primary"
              @click="confirmUpload"
            />
          </template>
          <UButton
            v-else-if="uploadStage === 'complete'"
            label="Done"
            @click="finishUpload"
          />
          <UButton
            v-else-if="uploadStage === 'failed'"
            label="Close"
            color="neutral"
            @click="cancelUpload"
          />
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="unlinkModalOpen"
      title="Unlink HSPT result?"
      description="This removes the association between this HSPT result and the applicant."
    >
      <template #body>
        <p class="text-sm">
          Confirm that you want to unlink
          <span class="font-medium">{{ selectedUnlinkResult?.submission?.mappedFields?.FullName || `${selectedUnlinkResult?.firstName || ''} ${selectedUnlinkResult?.lastName || ''}`.trim() }}</span>.
        </p>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton
            label="Cancel"
            color="neutral"
            variant="outline"
            @click="unlinkModalOpen = false"
          />
          <UButton
            label="Confirm Unlink"
            color="error"
            :loading="actionLoading.has(selectedUnlinkResult?._id || '')"
            @click="confirmUnlink"
          />
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="linkModalOpen"
      title="Link HSPT result to submission"
      description="Search all applicants in the selected cycle."
    >
      <template #body>
        <UFormField label="Applicant">
          <UInputMenu
            v-model="manualSubmissionId"
            :items="applicantItems"
            :loading="applicantsLoading"
            value-key="submissionId"
            placeholder="Type at least 2 characters"
            icon="i-lucide-search"
            ignore-filter
            class="w-full"
            @update:search-term="searchApplicants"
          />
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
          label="Link"
          :loading="actionLoading.has(selectedResult?._id || '')"
          @click="onManualLink"
        />
      </template>
    </UModal>
  </UContainer>
</template>
