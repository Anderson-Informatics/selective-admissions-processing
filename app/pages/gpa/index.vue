<script setup lang="ts">
import type { SelectItem, TableColumn } from '@nuxt/ui'

interface Cycle {
  _id: string
  year: string
  name: string
  active: boolean
}

interface GpaReviewItem {
  _id: string
  submissionId: string
  submissionIdInt?: number
  submissionName?: string
  student?: string
  status?: string
  currentStageName?: string
  gpaStatus?: string
  resolvedCumulativeGpa?: number | null
  resolvedSource?: 'recording' | 'dpscd' | 'optIn' | 'partial' | null
  enrollmentConsidered?: string | number | null
  hasOptInLabel?: boolean
  reviewCompletion?: Array<{ name: string, status: string, required: boolean, complete: boolean }>
  gpa?: {
    dpscd?: {
      snapshots?: { r1?: { cumulativeGpa?: number, quartersAvailable?: number, gpaStatus?: string }, all?: { cumulativeGpa?: number, quartersAvailable?: number, gpaStatus?: string } }
      selectedSnapshot?: 'r1' | 'all'
      selectedRound?: string
      selectionIssue?: string
      studentNumber?: number
      studentName?: string
      dob?: string
      schoolNumber?: number
      schoolName?: string
      gradeLevel?: number
      minimumEntryDate?: string
      latestExitDate?: string
      quartersAvailable?: number
      cumulativeGpa?: number
      gpaStatus?: string
      importedAt?: string
    }
    optIn?: {
      studentName?: string
      enrolledMinTerms?: 'yes' | 'no' | ''
      termsEnrolled?: number
      cumulativeGpa?: number
      schoolName?: string
      sourceFile?: string
      importedAt?: string
    }
    gpaMultiplier?: number | null
    gpaBonusEligible?: boolean
    gpaBonus?: number | null
    gpaScore?: number | null
    updatedAt?: string
  } | null
  recordingReview?: GpaReview
  partialReview?: GpaReview
  updatedAtTimestamp?: string
}

interface GpaReview {
  stageName?: string
  status?: string
  mappedData?: Record<string, unknown>
  completedAt?: string
  createdAt?: string
}

interface DuplicateStudentNumberItem {
  studentNumber: string
  duplicateCount: number
  submissionId: string
  submissionIdInt?: number
  applicationId?: string
  applicationName?: string
  projectId?: string
  student?: string
  status?: string
  currentStageName?: string
  gpaStatus?: string
  resolvedCumulativeGpa?: number | null
  resolvedSource?: 'recording' | 'dpscd' | 'optIn' | 'partial' | null
  dpscdStudentName?: string
  dpscdStudentNumber?: number
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

const statusItems: SelectItem[] = [
  { label: 'All statuses', value: 'all' },
  { label: 'Complete', value: 'Complete' },
  { label: 'Partial', value: 'Partial' },
  { label: 'DPSCD Partial', value: 'DPSCD Partial' },
  { label: 'Opt-In Partial', value: 'Opt-In Partial' },
  { label: 'Incomplete', value: 'Incomplete' }
]
const sourceItems: SelectItem[] = [
  { label: 'All final sources', value: 'all' },
  { label: 'GPA Recording', value: 'recording' },
  { label: 'Partial GPA', value: 'partial' },
  { label: 'DPSCD / PowerSchool', value: 'dpscd' },
  { label: 'Opt-In', value: 'optIn' },
  { label: 'No resolved source', value: 'none' }
]
const selectedStatus = ref('all')
const selectedSource = ref('all')
const page = ref(1)
const limit = 50

const searchInput = ref('')
const search = ref('')
const sorting = ref([{ id: 'student', desc: false }])
const expanded = ref({})

function applySearch() {
  search.value = searchInput.value.trim()
}

watch([selectedCycleId, selectedStatus, selectedSource, search, sorting], () => {
  page.value = 1
  expanded.value = {}
}, { deep: true })

const requestFetch = useRequestFetch()
const { data, status, refresh } = useAsyncData<{
  records: GpaReviewItem[]
  duplicateStudentNumbers: DuplicateStudentNumberItem[]
  total: number
  page: number
  limit: number
}>(
  'gpa-records',
  () => {
    if (!selectedCycleId.value) {
      return Promise.resolve({ records: [], duplicateStudentNumbers: [], total: 0, page: 1, limit })
    }
    const params = new URLSearchParams()
    params.set('cycleId', selectedCycleId.value)
    params.set('page', String(page.value))
    params.set('limit', String(limit))
    params.set('search', search.value)
    params.set('sortBy', sorting.value[0]?.id || 'student')
    params.set('sortOrder', sorting.value[0]?.desc === false ? 'asc' : 'desc')
    if (selectedStatus.value !== 'all') params.set('gpaStatus', selectedStatus.value)
    if (selectedSource.value !== 'all') params.set('source', selectedSource.value)
    return requestFetch(`/api/gpa?${params.toString()}`)
  },
  { default: () => ({ records: [], duplicateStudentNumbers: [], total: 0, page: 1, limit }), watch: [selectedCycleId, selectedStatus, selectedSource, search, sorting, page] }
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

const UButton = resolveComponent('UButton')

function sortableColumn(id: string, label: string): TableColumn<GpaReviewItem> {
  return {
    id,
    accessorKey: id,
    enableSorting: true,
    cell: ({ getValue }) => getValue() ?? '—',
    header: ({ column }) => h(UButton, {
      color: 'neutral',
      variant: 'ghost',
      label,
      icon: column.getIsSorted() ? (column.getIsSorted() === 'asc' ? 'i-lucide-arrow-up-narrow-wide' : 'i-lucide-arrow-down-wide-narrow') : 'i-lucide-arrow-up-down',
      class: '-mx-2.5',
      onClick: () => column.toggleSorting(column.getIsSorted() === 'asc')
    })
  }
}

const recordColumns: TableColumn<GpaReviewItem>[] = [
  { id: 'expand', header: 'Details', enableSorting: false },
  sortableColumn('submissionIdInt', 'Submission ID'),
  sortableColumn('student', 'Full Name'),
  sortableColumn('gpaStatus', 'GPA Status'),
  sortableColumn('resolvedCumulativeGpa', 'Final GPA'),
  sortableColumn('resolvedSource', 'Final GPA Source'),
  sortableColumn('enrollmentConsidered', 'Enrollment Considered'),
  sortableColumn('currentStageName', 'Current Stage'),
  { id: 'requiredAction', header: 'Required GPA Action', enableSorting: false }
]
const duplicateColumns: TableColumn<DuplicateStudentNumberItem>[] = [
  { accessorKey: 'studentNumber', header: 'Student Number' },
  { accessorKey: 'duplicateCount', header: 'Matches' },
  { accessorKey: 'submissionIdInt', header: 'Submission ID' },
  { accessorKey: 'student', header: 'Applicant' },
  { accessorKey: 'applicationName', header: 'Application' },
  { accessorKey: 'status', header: 'Submission Status' },
  { accessorKey: 'currentStageName', header: 'Current Stage' },
  { accessorKey: 'gpaStatus', header: 'GPA Status' },
  { accessorKey: 'resolvedSource', header: 'Final Source' },
  { accessorKey: 'dpscdStudentName', header: 'DPSCD Name' }
]
const duplicateStudentNumberCount = computed(() => new Set((data.value?.duplicateStudentNumbers || []).map(row => row.studentNumber)).size)
const duplicateSubmissionCount = computed(() => data.value?.duplicateStudentNumbers.length || 0)
const showDuplicateStudentNumbers = computed(() => selectedSource.value === 'dpscd')

const sourceLabels: Record<string, string> = {
  recording: 'GPA Recording',
  dpscd: 'DPSCD / PowerSchool',
  optIn: 'Opt-In',
  partial: 'Partial GPA'
}

function sourceLabel(source?: string | null) {
  return source ? sourceLabels[source] || source : '—'
}

function gpaStatusColor(status?: string) {
  if (status === 'Complete') return 'success' as const
  if (status === 'Incomplete') return 'error' as const
  return 'warning' as const
}

function requiredGpaAction(record: GpaReviewItem) {
  const action = (record.reviewCompletion || []).find(entry => entry.required && !entry.complete && /gpa/i.test(entry.name))
  return action ? `${action.name} — ${action.status}` : '—'
}

function formatEnrollment(record: GpaReviewItem) {
  const value = record.enrollmentConsidered
  if (value == null || value === '') return '—'
  if (record.resolvedSource === 'dpscd' || record.gpaStatus === 'DPSCD Partial') return `${value} quarter${value === 1 ? '' : 's'}`
  if (record.resolvedSource === 'optIn' || record.gpaStatus === 'Opt-In Partial') return `${value} term${value === 1 ? '' : 's'}`
  return String(value)
}

function formatOptInEnrollment(record: GpaReviewItem) {
  const optIn = record.gpa?.optIn
  if (!optIn) return '—'
  const terms = optIn.termsEnrolled != null ? ` (${optIn.termsEnrolled} term${optIn.termsEnrolled === 1 ? '' : 's'})` : ''
  if (optIn.enrolledMinTerms === 'yes') return `Yes${terms}`
  if (optIn.enrolledMinTerms === 'no') return `No${terms}`
  return terms ? `Unknown${terms}` : '—'
}

function reviewIssues(record: GpaReviewItem) {
  const issues = [
    record.gpa?.dpscd?.selectionIssue,
    record.gpa?.optIn && !record.hasOptInLabel ? 'Missing Opt-In label' : '',
    record.gpa?.optIn && record.gpa.optIn.enrolledMinTerms !== 'yes' ? 'Opt-In enrollment not confirmed' : ''
  ]
  if (record.gpaStatus !== 'Complete' && !record.recordingReview && !record.partialReview) {
    issues.push('No completed GPA Recording or Partial GPA review')
  }
  return issues.filter(Boolean).join('; ') || '—'
}

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString() : '—'
}
</script>

<template>
  <UContainer class="py-8">
    <PageHeader
      title="GPA Records"
      help="gpa"
      class="mb-6"
    />

    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-6">
      <UFormField label="Cycle">
        <USelect
          v-model="selectedCycleId"
          :items="(cycles || []).map(c => ({ label: `${c.year} — ${c.name}`, value: c._id }))"
          placeholder="Select a cycle"
          class="w-full"
        />
      </UFormField>

      <UFormField label="GPA Status">
        <USelect
          v-model="selectedStatus"
          :items="statusItems"
          class="w-full"
        />
      </UFormField>

      <UFormField label="Final GPA Source">
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

    <form
      class="flex flex-wrap items-end gap-2 mb-4"
      @submit.prevent="applySearch"
    >
      <UFormField
        label="Search GPA records"
        class="grow"
      >
        <UInput
          v-model="searchInput"
          placeholder="Name, DPSCD student number, or integer Submission ID"
          icon="i-lucide-search"
          class="w-full"
        />
      </UFormField>
      <UButton
        type="submit"
        label="Search"
      />
      <UButton
        color="neutral"
        variant="outline"
        label="Clear"
        @click="searchInput = ''; applySearch()"
      />
    </form>
    <p class="text-sm text-muted mb-2">
      Showing {{ data?.records.length || 0 }} of {{ data?.total || 0 }} records. Numeric searches match exact IDs.
    </p>

    <div
      v-if="status === 'pending' && !data?.records.length"
      class="text-muted"
    >
      Loading GPA records...
    </div>

    <UTable
      v-else
      v-model:sorting="sorting"
      v-model:expanded="expanded"
      :sorting-options="{ manualSorting: true }"
      :loading="status === 'pending'"
      :data="data?.records || []"
      :columns="recordColumns"
      :get-row-id="(row: GpaReviewItem) => row._id"
      empty="No submissions found for the selected cycle and filters."
    >
      <template #expand-cell="{ row }">
        <UButton
          variant="ghost"
          color="neutral"
          size="xs"
          :aria-label="row.getIsExpanded() ? 'Collapse GPA details' : 'Expand GPA details'"
          :icon="row.getIsExpanded() ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
          @click="row.toggleExpanded()"
        />
      </template>
      <template #student-cell="{ row }">
        <a
          :href="`https://dpscd.submittable.com/submissions/${row.original.submissionId}`"
          target="_blank"
          rel="noopener noreferrer"
          class="font-medium text-primary hover:underline"
        >
          {{ row.original.student || row.original.submissionName || '—' }}
        </a>
      </template>
      <template #gpaStatus-cell="{ row }">
        <UBadge
          :label="row.original.gpaStatus || 'Incomplete'"
          :color="gpaStatusColor(row.original.gpaStatus)"
          variant="subtle"
        />
      </template>
      <template #resolvedSource-cell="{ row }">
        {{ sourceLabel(row.original.resolvedSource) }}
      </template>
      <template #enrollmentConsidered-cell="{ row }">
        {{ formatEnrollment(row.original) }}
      </template>
      <template #requiredAction-cell="{ row }">
        {{ requiredGpaAction(row.original) }}
      </template>
      <template #expanded="{ row }">
        <div class="grid gap-6 p-4 md:grid-cols-2 xl:grid-cols-4 text-sm">
          <section>
            <h3 class="font-semibold mb-2">
              GPA Recording review
            </h3>
            <p>GPA: {{ row.original.recordingReview?.mappedData?.CumulativeGPA ?? '—' }}</p>
            <p>Able to record: {{ row.original.recordingReview?.mappedData?.AbleToRecord || '—' }}</p>
            <p>Status: {{ row.original.recordingReview?.status || '—' }}</p>
            <p>Completed: {{ formatDate(row.original.recordingReview?.completedAt) }}</p>
          </section>
          <section>
            <h3 class="font-semibold mb-2">
              Partial GPA review
            </h3>
            <p>GPA: {{ row.original.partialReview?.mappedData?.PartialGPA ?? '—' }}</p>
            <p>Semesters: {{ row.original.partialReview?.mappedData?.Semesters || '—' }}</p>
            <p>Status: {{ row.original.partialReview?.status || '—' }}</p>
            <p>Completed: {{ formatDate(row.original.partialReview?.completedAt) }}</p>
          </section>
          <section>
            <h3 class="font-semibold mb-2">
              DPSCD / PowerSchool
            </h3>
            <p>Student number: {{ row.original.gpa?.dpscd?.studentNumber ?? '—' }}</p>
            <p>Name in import: {{ row.original.gpa?.dpscd?.studentName || '—' }}</p>
            <p>DOB: {{ formatDate(row.original.gpa?.dpscd?.dob) }}</p>
            <p>Current school: {{ row.original.gpa?.dpscd?.schoolName || '—' }}<span v-if="row.original.gpa?.dpscd?.schoolNumber != null"> ({{ row.original.gpa.dpscd.schoolNumber }})</span></p>
            <p>Grade level: {{ row.original.gpa?.dpscd?.gradeLevel ?? '—' }}</p>
            <p>Enrollment dates: {{ formatDate(row.original.gpa?.dpscd?.minimumEntryDate) }} – {{ formatDate(row.original.gpa?.dpscd?.latestExitDate) }}</p>
            <p>GPA: {{ row.original.gpa?.dpscd?.cumulativeGpa ?? '—' }}</p>
            <p>Quarters: {{ row.original.gpa?.dpscd?.quartersAvailable ?? '—' }}</p>
            <p>Round: {{ row.original.gpa?.dpscd?.selectedRound || '—' }}</p>
            <p
              v-for="snapshot in (['r1', 'all'] as const)"
              :key="snapshot"
            >
              {{ snapshot === 'r1' ? 'Round 1' : 'All available' }}: GPA {{ row.original.gpa?.dpscd?.snapshots?.[snapshot]?.cumulativeGpa ?? '—' }} · Quarters {{ row.original.gpa?.dpscd?.snapshots?.[snapshot]?.quartersAvailable ?? '—' }} · Status {{ row.original.gpa?.dpscd?.snapshots?.[snapshot]?.gpaStatus || '—' }}
            </p>
            <p>Issue: {{ row.original.gpa?.dpscd?.selectionIssue || '—' }}</p>
            <p>Imported: {{ formatDate(row.original.gpa?.dpscd?.importedAt) }}</p>
          </section>
          <section>
            <h3 class="font-semibold mb-2">
              Opt-In upload
            </h3>
            <p>Name in file: {{ row.original.gpa?.optIn?.studentName || '—' }}</p>
            <p>School: {{ row.original.gpa?.optIn?.schoolName || '—' }}</p>
            <p>GPA: {{ row.original.gpa?.optIn?.cumulativeGpa ?? '—' }}</p>
            <p>Minimum enrollment met: {{ formatOptInEnrollment(row.original) }}</p>
            <p>Source file: {{ row.original.gpa?.optIn?.sourceFile || '—' }}</p>
            <p>Opt-In label: {{ row.original.gpa?.optIn ? (row.original.hasOptInLabel ? 'Present' : 'Missing') : '—' }}</p>
            <p>Imported: {{ formatDate(row.original.gpa?.optIn?.importedAt) }}</p>
          </section>
          <section class="md:col-span-2 xl:col-span-3">
            <h3 class="font-semibold mb-2">
              Stored scoring results
            </h3>
            <p class="text-muted mb-2">
              From the last completion refresh; distinct from raw imported values.
            </p>
            <p>Resolved GPA: {{ row.original.resolvedCumulativeGpa ?? '—' }}</p>
            <p>Resolved source: {{ sourceLabel(row.original.resolvedSource) }}</p>
            <p>Multiplier: {{ row.original.gpa?.gpaMultiplier ?? '—' }}</p>
            <p>Bonus eligible: {{ row.original.gpa?.gpaBonusEligible == null ? '—' : row.original.gpa.gpaBonusEligible ? 'Yes' : 'No' }}</p>
            <p>Bonus points: {{ row.original.gpa?.gpaBonus ?? '—' }}</p>
            <p>GPA score: {{ row.original.gpa?.gpaScore ?? '—' }}</p>
            <p>Record updated: {{ formatDate(row.original.gpa?.updatedAt || row.original.updatedAtTimestamp) }}</p>
          </section>
          <section>
            <h3 class="font-semibold mb-2">
              Review issues
            </h3>
            <p>{{ reviewIssues(row.original) }}</p>
          </section>
        </div>
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

    <section
      v-if="showDuplicateStudentNumbers"
      class="mt-8 rounded-lg border p-4"
    >
      <div class="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <h2 class="font-medium">
            Duplicate student numbers
          </h2>
          <p class="text-sm text-muted">
            Submissions in the selected cycle sharing the same mapped StudentNumber. This report covers all matching submissions when viewing DPSCD / PowerSchool GPA.
          </p>
        </div>
        <UBadge
          v-if="duplicateSubmissionCount"
          :label="`${duplicateStudentNumberCount} numbers / ${duplicateSubmissionCount} submissions`"
          color="warning"
          variant="subtle"
        />
      </div>
      <UTable
        :data="data?.duplicateStudentNumbers || []"
        :columns="duplicateColumns"
        :get-row-id="(row: DuplicateStudentNumberItem) => row.submissionId"
        :loading="status === 'pending'"
        empty="No duplicate student numbers found."
      >
        <template #studentNumber-cell="{ row }">
          <span class="font-medium">{{ row.original.studentNumber }}</span>
        </template>
        <template #duplicateCount-cell="{ row }">
          <UBadge
            :label="`${row.original.duplicateCount} matches`"
            color="warning"
            variant="subtle"
          />
        </template>
        <template #student-cell="{ row }">
          <a
            :href="`https://dpscd.submittable.com/submissions/${row.original.submissionId}`"
            target="_blank"
            rel="noopener noreferrer"
            class="font-medium text-primary hover:underline"
          >
            {{ row.original.student || row.original.submissionIdInt || row.original.submissionId }}
          </a>
        </template>
        <template #gpaStatus-cell="{ row }">
          <UBadge
            :label="row.original.gpaStatus || 'Incomplete'"
            :color="gpaStatusColor(row.original.gpaStatus)"
            variant="subtle"
          />
        </template>
        <template #resolvedSource-cell="{ row }">
          {{ sourceLabel(row.original.resolvedSource) }}
        </template>
        <template #applicationName-cell="{ row }">
          {{ row.original.applicationName || '—' }}
        </template>
        <template #status-cell="{ row }">
          {{ row.original.status || '—' }}
        </template>
        <template #currentStageName-cell="{ row }">
          {{ row.original.currentStageName || '—' }}
        </template>
        <template #dpscdStudentName-cell="{ row }">
          {{ row.original.dpscdStudentName || '—' }}
        </template>
      </UTable>
    </section>

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
