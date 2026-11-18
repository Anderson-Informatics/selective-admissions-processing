export interface GpaReview {
  stageName?: string
  status?: string
  mappedData?: Record<string, unknown>
  completedAt?: string
  createdAt?: string
}

export interface GpaReviewItem {
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

export const gpaSourceLabels: Record<string, string> = {
  recording: 'GPA Recording',
  dpscd: 'DPSCD / PowerSchool',
  optIn: 'Opt-In',
  partial: 'Partial GPA'
}

export function sourceLabel(source?: string | null) {
  return source ? gpaSourceLabels[source] || source : '—'
}

export function formatOptInEnrollment(record: GpaReviewItem) {
  const optIn = record.gpa?.optIn
  if (!optIn) return '—'
  const terms = optIn.termsEnrolled != null ? ` (${optIn.termsEnrolled} term${optIn.termsEnrolled === 1 ? '' : 's'})` : ''
  if (optIn.enrolledMinTerms === 'yes') return `Yes${terms}`
  if (optIn.enrolledMinTerms === 'no') return `No${terms}`
  return terms ? `Unknown${terms}` : '—'
}

export function reviewIssues(record: GpaReviewItem) {
  const issues = [
    record.gpa?.dpscd?.selectionIssue,
    record.gpa?.optIn && !record.hasOptInLabel ? 'Missing Opt-In label' : '',
    record.gpa?.optIn && record.gpa.optIn.enrolledMinTerms !== 'yes' ? 'Opt-In enrollment not confirmed' : ''
  ]
  if (record.gpaStatus !== 'Complete' && !record.recordingReview && !record.partialReview) {
    issues.push('No completed GPA Recording or Partial GPA review')
  }
  return issues.filter(Boolean)
}

export function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString() : '—'
}

export function gpaStatusColor(status?: string) {
  if (status === 'Complete') return 'success' as const
  if (status === 'Incomplete') return 'error' as const
  return 'warning' as const
}
