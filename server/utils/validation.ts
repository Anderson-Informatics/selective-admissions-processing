import type { AnyBulkWriteOperation } from 'mongoose'
import type { JobProgress } from '../models/Job'
import { ReviewModel } from '../models/Review'
import { ReviewStageModel } from '../models/ReviewStage'
import { SubmissionModel, type Submission } from '../models/Submission'
import { ValidationIssueModel, type ValidationIssue } from '../models/ValidationIssue'

export interface ValidationIssueInput {
  type: string
  severity: 'error' | 'warning' | 'info'
  field?: string
  message: string
}

export interface ValidationContext {
  cycleId: string
  referenceDate: Date
  allSubmissions: Submission[]
  fullNameGroups: Map<string, Submission[]>
  firstLastDobGroups: Map<string, Submission[]>
  completedStagesBySubmission: Map<string, Set<string>>
  requiredStagesByApplication: Map<string, { stageId: string, stageName: string }[]>
  reviewStageByApplicationAndStage: Map<string, { stageName: string, requiredForProgress: boolean }>
}

export type ProgressFn = (progress: Partial<JobProgress>) => Promise<void>

const RULES: { id: string, run: (submission: Submission, context: ValidationContext) => ValidationIssueInput[] }[] = [
  { id: 'dob_out_of_range', run: checkDobOutOfRange },
  { id: 'student_number_invalid', run: checkStudentNumber },
  { id: 'parent_student_name_swap', run: checkParentStudentNameSwap },
  { id: 'duplicate_applicant', run: checkDuplicateApplicant },
  { id: 'missing_required_documents', run: checkMissingRequiredDocuments },
  { id: 'incomplete_review_stage', run: checkIncompleteReviewStage },
  { id: 'geocoding_failed', run: checkGeocoding }
]

export async function runValidationForCycle(cycleId: string, setProgress?: ProgressFn) {
  await setProgress?.({
    phase: 'loading',
    message: 'Loading validation data',
    total: 0,
    processed: 0,
    percent: 0
  })

  const [submissions, reviewStages, reviews] = await Promise.all([
    SubmissionModel.find({ cycleId }).select('submissionId applicationId status mappedFields currentStageId currentStageName entryIds geocode').lean(),
    ReviewStageModel.find({ cycleId }).select('applicationId stageId stageName requiredForProgress').lean(),
    ReviewModel.find({ cycleId, status: 'complete' }).select('submissionId stageId').lean()
  ])

  const referenceDate = new Date()

  const isWithdrawn = (status: string | undefined) => status?.toLowerCase() === 'withdrawn'
  const activeSubmissions = submissions.filter(s => !isWithdrawn(s.status))

  const fullNameGroups = new Map<string, Submission[]>()
  const firstLastDobGroups = new Map<string, Submission[]>()
  for (const submission of activeSubmissions) {
    const mapped = submission.mappedFields || {}
    const fullName = normalizeName(String(mapped.FullName || ''))
    if (fullName) {
      const key = `${fullName}|${normalizeDate(String(mapped.DOB || ''))}`
      const list = fullNameGroups.get(key) || []
      list.push(submission)
      fullNameGroups.set(key, list)
    }
    const firstName = normalizeName(String(mapped.FirstName || ''))
    const lastName = normalizeName(String(mapped.LastName || ''))
    const dob = normalizeDate(String(mapped.DOB || ''))
    if (firstName && lastName) {
      const key = `${firstName}|${lastName}|${dob}`
      const list = firstLastDobGroups.get(key) || []
      list.push(submission)
      firstLastDobGroups.set(key, list)
    }
  }

  const completedStagesBySubmission = new Map<string, Set<string>>()
  for (const review of reviews) {
    const set = completedStagesBySubmission.get(review.submissionId) || new Set<string>()
    set.add(review.stageId)
    completedStagesBySubmission.set(review.submissionId, set)
  }

  const requiredStagesByApplication = new Map<string, { stageId: string, stageName: string }[]>()
  const reviewStageByApplicationAndStage = new Map<string, { stageName: string, requiredForProgress: boolean }>()
  for (const stage of reviewStages) {
    if (stage.role !== 'final') {
      const list = requiredStagesByApplication.get(String(stage.applicationId)) || []
      list.push({ stageId: stage.stageId, stageName: stage.name })
      requiredStagesByApplication.set(String(stage.applicationId), list)
    }
    if (stage.applicationId && stage.stageId) {
      reviewStageByApplicationAndStage.set(`${String(stage.applicationId)}|${stage.stageId}`, {
        stageName: stage.name,
        requiredForProgress: stage.role !== 'final'
      })
    }
  }

  const context: ValidationContext = {
    cycleId,
    referenceDate,
    allSubmissions: activeSubmissions,
    fullNameGroups,
    firstLastDobGroups,
    completedStagesBySubmission,
    requiredStagesByApplication,
    reviewStageByApplicationAndStage
  }

  await setProgress?.({
    phase: 'validating',
    message: `Validating ${activeSubmissions.length} submissions`,
    total: activeSubmissions.length,
    processed: 0,
    percent: activeSubmissions.length ? 0 : 100
  })

  const now = new Date()

  const overrideIssues = await ValidationIssueModel.find({
    cycleId,
    status: 'resolved',
    resolution: 'override'
  }).select('submissionId type field').lean()
  const overrideKeys = new Set(overrideIssues.map(i => `${i.submissionId}|${i.type}|${i.field || ''}`))

  function issueKey(submissionId: string, type: string, field?: string) {
    return `${submissionId}|${type}|${field || ''}`
  }

  let created = 0
  const batchSize = 100

  for (let i = 0; i < activeSubmissions.length; i += batchSize) {
    const batch = activeSubmissions.slice(i, i + batchSize)
    const operations: AnyBulkWriteOperation<ValidationIssue>[] = []

    for (const submission of batch) {
      const found: ValidationIssueInput[] = []
      for (const rule of RULES) {
        const result = rule.run(submission, context)
        if (result?.length) found.push(...result)
      }

      const seen = new Set<string>()
      for (const issue of found) {
        const key = `${issue.type}|${issue.field || ''}`
        if (seen.has(key)) continue
        seen.add(key)

        if (overrideKeys.has(issueKey(submission.submissionId, issue.type, issue.field))) continue

        operations.push({
          updateOne: {
            filter: {
              cycleId,
              submissionId: submission.submissionId,
              type: issue.type,
              field: issue.field || ''
            },
            update: {
              $setOnInsert: { createdAt: now },
              $set: {
                applicationId: submission.applicationId,
                severity: issue.severity,
                message: issue.message,
                status: 'open',
                updatedAt: now
              },
              $unset: { resolution: 1, resolvedAt: 1, resolvedBy: 1 }
            },
            upsert: true
          }
        })
      }
    }

    if (operations.length) {
      const result = await ValidationIssueModel.bulkWrite(operations)
      created += result.upsertedCount + result.modifiedCount
    }

    await setProgress?.({
      phase: 'validating',
      message: `Validated ${Math.min(i + batchSize, activeSubmissions.length)} / ${activeSubmissions.length} submissions`,
      total: activeSubmissions.length,
      processed: Math.min(i + batchSize, activeSubmissions.length),
      percent: Math.round((Math.min(i + batchSize, activeSubmissions.length) / activeSubmissions.length) * 100)
    })
  }

  const resolveResult = await ValidationIssueModel.updateMany(
    { cycleId, status: 'open', updatedAt: { $lt: now } },
    { $set: { status: 'resolved', resolution: 'auto', resolvedAt: now, updatedAt: now }, $unset: { resolvedBy: 1 } }
  )

  await setProgress?.({
    phase: 'completed',
    message: `Validation complete. ${created} open issues, ${resolveResult.modifiedCount} resolved.`,
    total: activeSubmissions.length,
    processed: activeSubmissions.length,
    percent: 100
  })

  return {
    total: activeSubmissions.length,
    created,
    resolved: resolveResult.modifiedCount || 0
  }
}

function checkDobOutOfRange(submission: Submission, context: ValidationContext): ValidationIssueInput[] {
  const mapped = submission.mappedFields || {}
  const raw = String(mapped.DOB || mapped.Birth || '').trim()
  if (!raw) {
    return [{ type: 'dob_out_of_range', severity: 'error', field: 'DOB', message: 'Date of birth is missing' }]
  }
  const date = parseDate(raw)
  if (!date) {
    return [{ type: 'dob_out_of_range', severity: 'error', field: 'DOB', message: `Date of birth is not a valid date: ${raw}` }]
  }
  if (date > new Date()) {
    return [{ type: 'dob_out_of_range', severity: 'error', field: 'DOB', message: 'Date of birth is in the future' }]
  }

  const age = getAgeAt(date, context.referenceDate)
  if (age < 5 || age > 21) {
    return [{ type: 'dob_out_of_range', severity: 'warning', field: 'DOB', message: `Date of birth gives age ${age}, outside the expected 5-21 range` }]
  }

  const grade = parseGrade(String(mapped.Grade || mapped.GradeEntering || mapped.CurrentGrade || ''))
  if (grade && grade >= 6 && grade <= 12) {
    const expectedAge = grade + 5
    if (Math.abs(age - expectedAge) > 2) {
      return [{ type: 'dob_out_of_range', severity: 'warning', field: 'DOB', message: `Age ${age} is outside the typical ±2 year range for grade ${grade}` }]
    }
  }

  return []
}

function checkStudentNumber(submission: Submission): ValidationIssueInput[] {
  const mapped = submission.mappedFields || {}
  const isDpscd = ['yes', 'true', '1'].includes(String(mapped.DPSCD || '').toLowerCase())
  const studentNumber = String(mapped.StudentNumber || '').trim()

  if (!isDpscd) return []

  const issues: ValidationIssueInput[] = []
  if (!studentNumber) {
    issues.push({ type: 'student_number_invalid', severity: 'error', field: 'StudentNumber', message: 'DPSCD applicant is missing a student number' })
    return issues
  }

  const digitsOnly = /^\d+$/.test(studentNumber)
  if (!digitsOnly) {
    issues.push({ type: 'student_number_invalid', severity: 'error', field: 'StudentNumber', message: 'Student number must be numeric' })
  } else if (studentNumber.startsWith('0')) {
    issues.push({ type: 'student_number_invalid', severity: 'warning', field: 'StudentNumber', message: 'Student number starts with a leading zero' })
  }

  if (digitsOnly && studentNumber.length !== 7) {
    issues.push({ type: 'student_number_length', severity: 'warning', field: 'StudentNumber', message: `Student number has ${studentNumber.length} digits; expected 7` })
  }

  return issues
}

function checkParentStudentNameSwap(submission: Submission): ValidationIssueInput[] {
  const mapped = submission.mappedFields || {}
  const firstName = String(mapped.FirstName || '').trim().toLowerCase()
  const parentFirstName = String(mapped.ParentFirstName || '').trim().toLowerCase()

  if (firstName && parentFirstName && firstName === parentFirstName) {
    return [{ type: 'parent_student_name_swap', severity: 'warning', field: 'FirstName', message: 'Applicant first name matches parent first name; fields may be swapped' }]
  }

  return []
}

function checkDuplicateApplicant(submission: Submission, context: ValidationContext): ValidationIssueInput[] {
  const mapped = submission.mappedFields || {}
  const issues: ValidationIssueInput[] = []
  const fullName = normalizeName(String(mapped.FullName || ''))
  const dob = normalizeDate(String(mapped.DOB || ''))

  if (fullName) {
    const key = `${fullName}|${dob}`
    const group = context.fullNameGroups.get(key)
    if (group && group.length > 1) {
      const others = group.filter(s => s.submissionId !== submission.submissionId).map(s => s.submissionId).join(', ')
      issues.push({ type: 'duplicate_applicant', severity: 'error', field: 'FullName', message: `Duplicate submission(s) by full name and DOB: ${others}` })
    }
  }

  const firstName = normalizeName(String(mapped.FirstName || ''))
  const lastName = normalizeName(String(mapped.LastName || ''))
  if (firstName && lastName) {
    const key = `${firstName}|${lastName}|${dob}`
    const group = context.firstLastDobGroups.get(key)
    if (group && group.length > 1) {
      const others = group.filter(s => s.submissionId !== submission.submissionId).map(s => s.submissionId).join(', ')
      issues.push({ type: 'duplicate_applicant', severity: 'error', field: 'FirstName,LastName', message: `Duplicate submission(s) by first name, last name, and DOB: ${others}` })
    }
  }

  return issues
}

function checkMissingRequiredDocuments(submission: Submission): ValidationIssueInput[] {
  const mapped = submission.mappedFields || {}
  const hasIep = isYes(mapped.IEPor504) || isYes(mapped.IEPorNPSPor504)
  if (!hasIep) return []

  const iep = String(mapped.UploadIEP || '').trim()
  const plan504 = String(mapped.Upload504 || '').trim()
  if (!iep && !plan504) {
    return [{ type: 'missing_required_documents', severity: 'warning', field: 'UploadIEP,Upload504', message: 'Applicant indicates an IEP/504 but no IEP or 504 plan has been uploaded' }]
  }

  return []
}

function checkIncompleteReviewStage(submission: Submission, context: ValidationContext): ValidationIssueInput[] {
  if (!submission.currentStageId) return []

  const stage = context.reviewStageByApplicationAndStage.get(`${submission.applicationId}|${submission.currentStageId}`)
  if (!stage?.requiredForProgress) return []

  const completed = context.completedStagesBySubmission.get(submission.submissionId) || new Set<string>()
  if (completed.has(submission.currentStageId)) return []

  return [{ type: 'incomplete_review_stage', severity: 'warning', field: 'currentStageName', message: `Current review stage "${stage.stageName}" is incomplete` }]
}

function checkGeocoding(submission: Submission): ValidationIssueInput[] {
  const status = submission.geocode?.status
  if (status === 'no_address') {
    return [{ type: 'geocoding_failed', severity: 'warning', field: 'Address1', message: 'Missing or incomplete address; catchment could not be determined' }]
  }
  if (status === 'failed') {
    return [{ type: 'geocoding_failed', severity: 'error', field: 'Address1', message: `Address could not be geocoded${submission.geocode?.error ? `: ${submission.geocode.error}` : ''}` }]
  }
  return []
}

function parseDate(value: string): Date | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date
}

function getAgeAt(dob: Date, reference: Date): number {
  let age = reference.getFullYear() - dob.getFullYear()
  const monthDiff = reference.getMonth() - dob.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && reference.getDate() < dob.getDate())) {
    age--
  }
  return age
}

function parseGrade(value: string): number | null {
  const match = /(\d+)/.exec(value)
  return match ? Number(match[1]) : null
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '').trim()
}

function normalizeDate(value: string): string {
  const date = parseDate(value)
  if (!date) return ''
  return date.toISOString().slice(0, 10)
}

function isYes(value: unknown): boolean {
  return ['yes', 'true', '1'].includes(String(value).toLowerCase())
}
