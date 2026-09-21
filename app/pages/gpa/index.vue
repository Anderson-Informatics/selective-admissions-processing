<script setup lang="ts">
import type { SelectItem, TableColumn } from '@nuxt/ui'

interface Cycle {
  _id: string
  year: string
  name: string
  active: boolean
}

interface GpaRecordItem {
  _id: string
  submissionId: string
  submissionIdInt?: number
  submissionName: string
  hasOptInLabel: boolean
  dpscd?: {
    studentNumber?: number
    quartersAvailable?: number
    cumulativeGpa?: number
    gpaStatus?: string
    yearEnd?: number
    importedAt?: string
  }
  optIn?: {
    studentName: string
    firstName: string
    lastName: string
    enrolledMinTerms?: 'yes' | 'no' | ''
    enrolledMinTermsFlag?: boolean
    termsEnrolled?: number
    cumulativeGpa?: number
    schoolName: string
    sourceFile: string
    importedAt?: string
  }
  updatedAt?: string
}

interface PreviewRow {
  file: string
  row: number
  submissionIdInt?: number
  studentName: string
  submissionName?: string
  cumulativeGpa?: number
  status: 'matched' | 'missing_optin_label' | 'unmatched' | 'invalid_gpa' | 'not_enrolled'
  warnings: string[]
}

interface UploadPreview {
  files: number
  processed: number
  matched: number
  missingOptInLabel: number
  unmatched: number
  invalidGpa: number
  notEnrolled: number
  optInMissingFromFile: number
  optInLabelResolved: boolean
  rows: PreviewRow[]
  errors: string[]
}

interface UploadResult {
  processed: number
  updated: number
  inserted: number
  skippedUnmatched: number
  skippedInvalid: number
  missingOptInLabel: number
  notEnrolled: number
  warnings: string[]
  errors: string[]
}

interface UploadStatusResponse {
  upload: {
    status: 'previewing' | 'importing' | 'ready' | 'confirming' | 'completed' | 'failed' | 'cancelled'
    preview?: UploadPreview
    result?: UploadResult
    error?: string
  }
  job?: {
    status: 'pending' | 'running' | 'completed' | 'failed'
    progress?: { percent?: number, message?: string }
    error?: string
  }
}

const { data: cycles } = await useFetch<Cycle[]>('/api/cycles')
const selectedCycleId = ref('')

watchEffect(() => {
  const active = cycles.value?.find(c => c.active)
  if (active && !selectedCycleId.value) {
    selectedCycleId.value = active._id
  }
})

const sourceItems: SelectItem[] = [
  { label: 'All sources', value: 'all' },
  { label: 'Opt-In', value: 'opt_in' },
  { label: 'DPSCD', value: 'dpscd' }
]
const selectedSource = ref('all')
const page = ref(1)
const limit = 50

watch([selectedCycleId, selectedSource], () => {
  page.value = 1
  refresh()
})
watch(page, () => refresh())

const requestFetch = useRequestFetch()
const { data, status, refresh } = useAsyncData<{
  records: GpaRecordItem[]
  total: number
  page: number
  limit: number
}>(
  'gpa-records',
  () => {
    if (!selectedCycleId.value) {
      return Promise.resolve({ records: [], total: 0, page: 1, limit })
    }
    const params = new URLSearchParams()
    params.set('cycleId', selectedCycleId.value)
    params.set('page', String(page.value))
    params.set('limit', String(limit))
    if (selectedSource.value !== 'all') params.set('source', selectedSource.value)
    return requestFetch(`/api/gpa/optin?${params.toString()}`)
  },
  { default: () => ({ records: [], total: 0, page: 1, limit }) }
)

const totalPages = computed(() => Math.ceil((data.value?.total || 0) / limit))

const { data: jobs } = await useFetch<{ _id: string, type: string, status: string, result?: Record<string, number>, createdAt: string }[]>(
  '/api/jobs',
  { query: computed(() => ({ cycleId: selectedCycleId.value })) }
)
const latestDpscdImport = computed(() => (jobs.value || []).find(job => job.type === 'dpscd_gpa_import'))

// --- Upload modal -----------------------------------------------------------

const uploadModalOpen = ref(false)
const uploadStage = ref<'select' | 'previewing' | 'review' | 'importing' | 'complete' | 'failed'>('select')
const uploadFiles = ref<File[]>([])
const uploadId = ref('')
const uploadProgress = ref(0)
const uploadMessage = ref('')
const uploadPreview = ref<UploadPreview | null>(null)
const uploadResult = ref<UploadResult | null>(null)
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
    const response = await $fetch<UploadStatusResponse>(`/api/gpa/optin/uploads/${uploadId.value}`)
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
      uploadError.value = response.upload.error || response.job?.error || 'Opt-In GPA processing failed'
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
  uploadMessage.value = 'Uploading Excel files'
  try {
    const response = await $fetch<{ uploadId: string }>('/api/gpa/optin/uploads', { method: 'POST', body: formData })
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
    await $fetch(`/api/gpa/optin/uploads/${uploadId.value}/confirm`, { method: 'POST' })
    await pollUpload()
  } catch (error: unknown) {
    uploadError.value = (error as { data?: { statusMessage?: string } }).data?.statusMessage || 'Failed to confirm upload'
    uploadStage.value = 'failed'
  }
}

async function cancelUpload() {
  clearUploadPoll()
  if (uploadId.value && uploadStage.value === 'review') {
    await $fetch(`/api/gpa/optin/uploads/${uploadId.value}/cancel`, { method: 'POST' }).catch(() => undefined)
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
})

function rowStatusColor(status: PreviewRow['status']) {
  if (status === 'matched') return 'success' as const
  if (status === 'missing_optin_label' || status === 'not_enrolled') return 'warning' as const
  return 'error' as const
}

function rowStatusLabel(status: PreviewRow['status']) {
  if (status === 'matched') return 'Matched'
  if (status === 'missing_optin_label') return 'No Opt-In label'
  if (status === 'unmatched') return 'Unmatched'
  if (status === 'invalid_gpa') return 'Invalid GPA'
  return 'Not enrolled min terms'
}

const previewColumns: TableColumn<PreviewRow>[] = [
  { accessorKey: 'file', header: 'File' },
  { accessorKey: 'row', header: 'Row' },
  { accessorKey: 'submissionIdInt', header: 'Submission ID' },
  { accessorKey: 'studentName', header: 'Student' },
  { accessorKey: 'submissionName', header: 'Application' },
  { accessorKey: 'cumulativeGpa', header: 'GPA' },
  { id: 'status', header: 'Status', enableSorting: false }
]

const recordColumns: TableColumn<GpaRecordItem>[] = [
  { accessorKey: 'submissionIdInt', header: 'Submission ID' },
  { id: 'student', header: 'Student', enableSorting: false },
  { id: 'optInLabel', header: 'Opt-In', enableSorting: false },
  { id: 'optInSchool', header: 'School', enableSorting: false },
  { id: 'optInGpa', header: 'Opt-In GPA', enableSorting: false },
  { id: 'enrolled', header: 'Enrolled', enableSorting: false },
  { id: 'dpscdGpa', header: 'DPSCD GPA', enableSorting: false },
  { id: 'quarters', header: 'Quarters', enableSorting: false }
]

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString() : '—'
}
</script>

<template>
  <UContainer class="py-8">
    <h1 class="text-2xl font-semibold mb-6">
      GPA Records
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

      <UFormField label="Source">
        <USelect
          v-model="selectedSource"
          :items="sourceItems"
          class="w-full"
        />
      </UFormField>

      <div class="flex items-end">
        <UButton
          icon="i-lucide-upload"
          :disabled="!selectedCycleId"
          @click="openUploadModal"
        >
          Upload Opt-In GPA files
        </UButton>
      </div>
    </div>

    <UCard
      v-if="latestDpscdImport"
      class="mb-6"
    >
      <div class="flex flex-wrap items-center gap-3 text-sm">
        <span class="font-medium">Latest DPSCD import</span>
        <UBadge
          :label="latestDpscdImport.status"
          :color="latestDpscdImport.status === 'completed' ? 'success' : latestDpscdImport.status === 'failed' ? 'error' : 'warning'"
          variant="subtle"
        />
        <span class="text-muted">{{ formatDate(latestDpscdImport.createdAt) }}</span>
        <span
          v-if="latestDpscdImport.result"
          class="text-muted"
        >
          — {{ latestDpscdImport.result.matched ?? 0 }} matched, {{ latestDpscdImport.result.unmatched ?? 0 }} unmatched, {{ latestDpscdImport.result.updated ?? 0 }} updated
        </span>
      </div>
    </UCard>

    <div
      v-if="status === 'pending' && !data?.records.length"
      class="text-muted"
    >
      Loading GPA records...
    </div>

    <UTable
      v-else
      :data="data?.records || []"
      :columns="recordColumns"
      :get-row-id="(row: GpaRecordItem) => row._id"
    >
      <template #student-cell="{ row }">
        {{ row.original.submissionName || row.original.optIn?.studentName || '—' }}
      </template>
      <template #optInLabel-cell="{ row }">
        <UBadge
          v-if="row.original.optIn"
          :label="row.original.hasOptInLabel ? 'Opt-In' : 'No label'"
          :color="row.original.hasOptInLabel ? 'success' : 'warning'"
          variant="subtle"
        />
        <span
          v-else
          class="text-muted"
        >—</span>
      </template>
      <template #optInSchool-cell="{ row }">
        {{ row.original.optIn?.schoolName || '—' }}
      </template>
      <template #optInGpa-cell="{ row }">
        {{ row.original.optIn?.cumulativeGpa ?? '—' }}
      </template>
      <template #enrolled-cell="{ row }">
        <span v-if="row.original.optIn">
          {{ row.original.optIn.enrolledMinTerms || '—' }}<span
            v-if="row.original.optIn.enrolledMinTerms === 'no' && row.original.optIn.termsEnrolled != null"
            class="text-muted"
          > ({{ row.original.optIn.termsEnrolled }} terms)</span>
        </span>
        <span
          v-else
          class="text-muted"
        >—</span>
      </template>
      <template #dpscdGpa-cell="{ row }">
        {{ row.original.dpscd?.cumulativeGpa ?? '—' }}
      </template>
      <template #quarters-cell="{ row }">
        {{ row.original.dpscd?.quartersAvailable ?? '—' }}
      </template>
    </UTable>

    <div
      v-if="totalPages > 1"
      class="flex justify-center mt-4"
    >
      <UPagination
        v-model:page="page"
        :total="data?.total || 0"
        :items-per-page="limit"
      />
    </div>

    <UModal
      v-model:open="uploadModalOpen"
      title="Upload Opt-In GPA files"
      :ui="{ content: '!max-w-4xl' }"
      @update:open="(open: boolean) => { if (!open) cancelUpload() }"
    >
      <template #body>
        <div v-if="uploadStage === 'select'">
          <UFormField label="Opt-In GPA files (.xlsx)">
            <input
              type="file"
              multiple
              accept=".xlsx,.xls"
              class="block w-full text-sm"
              @change="selectUploadFiles"
            >
          </UFormField>
          <p class="text-sm text-muted mt-3">
            One file per opt-in school. Only submissions whose Submission ID appears in the files are updated.
          </p>
          <p
            v-if="uploadFiles.length"
            class="text-sm mt-2"
          >
            {{ uploadFiles.length }} file{{ uploadFiles.length === 1 ? '' : 's' }} selected
          </p>
        </div>

        <div v-else-if="uploadProcessing">
          <UProgress
            :model-value="uploadProgress"
            :max="100"
            class="mb-2"
          />
          <p class="text-sm text-muted">
            {{ uploadMessage || 'Processing...' }}
          </p>
        </div>

        <div v-else-if="uploadStage === 'review' && uploadPreview">
          <div class="flex flex-wrap gap-2 mb-4">
            <UBadge
              :label="`${uploadPreview.matched} matched`"
              color="success"
              variant="subtle"
            />
            <UBadge
              :label="`${uploadPreview.missingOptInLabel} missing Opt-In label`"
              color="warning"
              variant="subtle"
            />
            <UBadge
              :label="`${uploadPreview.notEnrolled} not enrolled min terms`"
              color="warning"
              variant="subtle"
            />
            <UBadge
              :label="`${uploadPreview.unmatched} unmatched`"
              color="error"
              variant="subtle"
            />
            <UBadge
              :label="`${uploadPreview.invalidGpa} invalid GPA`"
              color="error"
              variant="subtle"
            />
            <UBadge
              :label="`${uploadPreview.optInMissingFromFile} Opt-In not in file`"
              color="neutral"
              variant="subtle"
            />
          </div>
          <UAlert
            v-if="!uploadPreview.optInLabelResolved"
            color="warning"
            variant="subtle"
            title="Opt-In label not found in synced metadata"
            description="Run Metadata Sync so the Opt-In label can be resolved; label warnings may be inaccurate."
            class="mb-4"
          />
          <UAlert
            v-if="uploadPreview.errors.length"
            color="error"
            variant="subtle"
            :title="`${uploadPreview.errors.length} file error(s)`"
            :description="uploadPreview.errors.join('\n')"
            class="mb-4"
          />
          <div class="overflow-auto max-h-96 border rounded-lg">
            <UTable
              :data="uploadPreview.rows"
              :columns="previewColumns"
              :get-row-id="(row: PreviewRow) => `${row.file}:${row.row}`"
            >
              <template #status-cell="{ row }">
                <UBadge
                  :label="rowStatusLabel(row.original.status)"
                  :color="rowStatusColor(row.original.status)"
                  variant="subtle"
                />
                <p
                  v-if="row.original.warnings.length"
                  class="text-xs text-muted mt-1"
                >
                  {{ row.original.warnings.join('; ') }}
                </p>
              </template>
            </UTable>
          </div>
        </div>

        <div v-else-if="uploadStage === 'complete' && uploadResult">
          <UAlert
            color="success"
            variant="subtle"
            title="Opt-In GPA import complete"
            :description="`${uploadResult.updated + uploadResult.inserted} records written (${uploadResult.inserted} new, ${uploadResult.updated} updated), ${uploadResult.skippedUnmatched} unmatched skipped, ${uploadResult.missingOptInLabel} imported without Opt-In label.`"
          />
          <pre
            v-if="uploadResult.warnings.length"
            class="text-xs bg-muted p-4 rounded overflow-auto max-h-48 mt-4"
          >{{ uploadResult.warnings.join('\n') }}</pre>
        </div>

        <div v-else-if="uploadStage === 'failed'">
          <UAlert
            color="error"
            variant="subtle"
            title="Upload failed"
            :description="uploadError"
          />
        </div>
      </template>

      <template #footer="{ close }">
        <div class="flex gap-2">
          <UButton
            v-if="uploadStage === 'select'"
            :disabled="!uploadFiles.length"
            @click="startUploadPreview"
          >
            Preview import
          </UButton>
          <UButton
            v-if="uploadStage === 'review'"
            color="success"
            @click="confirmUpload"
          >
            Confirm import
          </UButton>
          <UButton
            v-if="uploadStage === 'complete' || uploadStage === 'failed'"
            color="neutral"
            @click="finishUpload"
          >
            Done
          </UButton>
          <UButton
            color="neutral"
            variant="outline"
            :disabled="uploadProcessing"
            @click="uploadStage === 'complete' || uploadStage === 'failed' ? (finishUpload(), close()) : cancelUpload()"
          >
            {{ uploadStage === 'review' ? 'Cancel import' : 'Close' }}
          </UButton>
        </div>
      </template>
    </UModal>
  </UContainer>
</template>
