import JSON5 from 'json5'
import * as XLSX from 'xlsx'
import type { AnyBulkWriteOperation } from 'mongoose'
import type { JobProgress } from '../models/Job'
import { GpaRecordModel, type GpaRecord } from '../models/GpaRecord'
import { GpaUploadModel } from '../models/GpaUpload'
import { MetadataModel } from '../models/Metadata'
import { SubmissionModel } from '../models/Submission'
import { fetchSubmissionsForProject, type SubmittableClientConfig } from './submittable'
import { mapWithConcurrency } from './concurrency'

type ProgressFn = (update: Partial<JobProgress>) => Promise<void>

const MAX_ISSUE_MESSAGES = 200

// ---------------------------------------------------------------------------
// Submission labels / Opt-In resolution
// ---------------------------------------------------------------------------

export async function resolveOptInLabelId(): Promise<string | undefined> {
  const label = await MetadataModel.findOne({
    type: 'label',
    name: { $regex: /^\s*opt[-\s]?in\s*$/i }
  }).select('externalId name').lean()
  return label?.externalId
}

export async function syncSubmissionLabels(
  cycleId: string,
  setProgress?: ProgressFn,
  clientConfig?: SubmittableClientConfig
): Promise<number> {
  const projectIds = await SubmissionModel.distinct('projectId', { cycleId })
  if (!projectIds.length) return 0

  const labelsBySubmissionId = new Map<string, string[]>()
  await mapWithConcurrency(projectIds, 3, async (projectId, index) => {
    const submissions = await fetchSubmissionsForProject(projectId, clientConfig)
    for (const submission of submissions) {
      if (submission.labels) labelsBySubmissionId.set(submission.submissionId, submission.labels)
    }
    await setProgress?.({
      phase: 'syncing_labels',
      processed: index + 1,
      total: projectIds.length,
      message: `Synced labels for ${index + 1} / ${projectIds.length} projects`
    })
  })

  const ops = [...labelsBySubmissionId].map(([submissionId, labelIds]) => ({
    updateOne: {
      filter: { cycleId, submissionId },
      update: { $set: { labelIds } }
    }
  }))
  for (let i = 0; i < ops.length; i += 500) {
    await SubmissionModel.bulkWrite(ops.slice(i, i + 500))
  }
  return ops.length
}

// ---------------------------------------------------------------------------
// DPSCD payload ingestion
// ---------------------------------------------------------------------------

export function parseDpscdBody(raw: string): { cycleId?: string, records: Record<string, unknown>[] } {
  const trimmed = (raw || '').trim()
  if (!trimmed) return { records: [] }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    const normalized = trimmed
      .replace(/\bNone\b/g, 'null')
      .replace(/\bTrue\b/g, 'true')
      .replace(/\bFalse\b/g, 'false')
      .replace(/\bnan\b|\bNaN\b/g, 'null')
    parsed = JSON5.parse(normalized)
  }

  if (Array.isArray(parsed)) {
    return { records: parsed as Record<string, unknown>[] }
  }
  const envelope = parsed as { cycleId?: unknown, records?: unknown[] } | null
  if (!envelope || !Array.isArray(envelope.records)) {
    throw createError({ statusCode: 400, statusMessage: 'Body must be an array of records or an object with a records array' })
  }
  return { cycleId: envelope.cycleId == null ? undefined : String(envelope.cycleId), records: envelope.records as Record<string, unknown>[] }
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '')
}

const INT_FIELD_KEYS = new Set(['studentNumber', 'submissionIdInt', 'quartersAvailable', 'yearEnd', 'gradeLevel', 'middleSchoolNumber', 'acceptingHighSchoolNumber'])

const DPSCD_FIELD_MAP: Record<string, string> = {
  submissionid: 'submissionId',
  submissionidint: 'submissionIdInt',
  studentnumber: 'studentNumber',
  quartersavailable: 'quartersAvailable',
  gpacumulative: 'cumulativeGpa',
  cumulativegpa: 'cumulativeGpa',
  gpastatus: 'gpaStatus',
  yearend: 'yearEnd',
  latestgradelevel: 'gradeLevel',
  gradelevel: 'gradeLevel',
  middleschoolnumber: 'middleSchoolNumber',
  projectname: 'projectName',
  submissionstatus: 'submissionStatus',
  stagename: 'stageName',
  completedat: 'completedAt',
  acceptinghighschool: 'acceptingHighSchool',
  acceptinghighschoolnumber: 'acceptingHighSchoolNumber'
}

const DPSCD_DATE_FIELDS = new Set(['completedat', 'dob', 'minimumentrydate', 'latestexitdate'])

function toInt(value: unknown): number | undefined {
  if (value == null || value === '') return undefined
  const n = Number(value)
  if (!Number.isFinite(n)) return undefined
  return Math.round(n)
}

function toFloat(value: unknown): number | undefined {
  if (value == null || value === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

function toDate(value: unknown): Date | undefined {
  if (value == null || value === '') return undefined
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? undefined : date
}

interface NormalizedDpscdRecord {
  submissionId?: string
  submissionIdInt?: number
  studentNumber?: number
  quartersAvailable?: number
  cumulativeGpa?: number
  gpaStatus?: string
  yearEnd?: number
  gradeLevel?: number
  middleSchoolNumber?: number
  projectName?: string
  submissionStatus?: string
  stageName?: string
  acceptingHighSchool?: string
  acceptingHighSchoolNumber?: number
  completedAt?: Date
  extra: Record<string, unknown>
}

export function normalizeDpscdRecord(raw: Record<string, unknown>): NormalizedDpscdRecord {
  const out: NormalizedDpscdRecord = { extra: {} }
  for (const [key, value] of Object.entries(raw || {})) {
    const field = DPSCD_FIELD_MAP[normalizeKey(key)]
    if (field === 'submissionId') {
      out.submissionId = value == null ? undefined : String(value).trim() || undefined
    } else if (field && INT_FIELD_KEYS.has(field)) {
      out[field as 'studentNumber'] = toInt(value)
    } else if (field === 'cumulativeGpa') {
      out.cumulativeGpa = toFloat(value)
    } else if (field === 'completedAt') {
      out.completedAt = toDate(value)
    } else if (field) {
      out[field as 'gpaStatus'] = value == null ? undefined : String(value).trim() || undefined
    } else if (DPSCD_DATE_FIELDS.has(normalizeKey(key))) {
      out.extra[key] = toDate(value)
    } else {
      out.extra[key] = value
    }
  }
  return out
}

interface SubmissionLookup {
  bySubmissionId: Map<string, { submissionId: string, submissionIdInt?: number, studentNumber: string }>
  bySubmissionIdInt: Map<number, { submissionId: string, submissionIdInt?: number, studentNumber: string }>
  byStudentNumber: Map<string, { submissionId: string, submissionIdInt?: number, studentNumber: string }>
}

async function loadSubmissionLookup(cycleId: string): Promise<SubmissionLookup> {
  const submissions = await SubmissionModel.find({ cycleId })
    .select('submissionId submissionIdInt mappedFields.StudentNumber')
    .lean()
  const lookup: SubmissionLookup = {
    bySubmissionId: new Map(),
    bySubmissionIdInt: new Map(),
    byStudentNumber: new Map()
  }
  for (const sub of submissions) {
    const entry = {
      submissionId: sub.submissionId,
      submissionIdInt: sub.submissionIdInt,
      studentNumber: String((sub.mappedFields as Record<string, unknown> | undefined)?.StudentNumber ?? '').trim()
    }
    lookup.bySubmissionId.set(sub.submissionId, entry)
    if (sub.submissionIdInt != null) lookup.bySubmissionIdInt.set(sub.submissionIdInt, entry)
    if (entry.studentNumber) lookup.byStudentNumber.set(entry.studentNumber, entry)
  }
  return lookup
}

export interface DpscdImportResult {
  processed: number
  matched: number
  inserted: number
  updated: number
  unmatched: number
  warnings: string[]
  errors: string[]
}

export async function importDpscdGpaRecords(
  uploadId: string,
  jobId: string,
  setProgress: ProgressFn
): Promise<DpscdImportResult> {
  const upload = await GpaUploadModel.findOne({ _id: uploadId, source: 'dpscd', status: 'importing' })
  if (!upload) throw new Error('Staged DPSCD GPA import is unavailable')

  const records = upload.records || []
  const result: DpscdImportResult = { processed: 0, matched: 0, inserted: 0, updated: 0, unmatched: 0, warnings: [], errors: [] }

  try {
    await setProgress({ phase: 'matching', total: records.length, processed: 0, percent: 0, message: `Normalizing ${records.length} DPSCD records` })
    const lookup = await loadSubmissionLookup(upload.cycleId)
    const importedAt = new Date()
    const operations: AnyBulkWriteOperation<GpaRecord>[] = []

    for (let i = 0; i < records.length; i++) {
      const raw = records[i]
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        result.errors.push(`Record ${i + 1}: not an object`)
        continue
      }
      const record = normalizeDpscdRecord(raw)

      let match
      if (record.submissionId && lookup.bySubmissionId.has(record.submissionId)) {
        match = lookup.bySubmissionId.get(record.submissionId)
      } else if (record.submissionIdInt != null && lookup.bySubmissionIdInt.has(record.submissionIdInt)) {
        match = lookup.bySubmissionIdInt.get(record.submissionIdInt)
      } else if (record.studentNumber != null && lookup.byStudentNumber.has(String(record.studentNumber))) {
        match = lookup.byStudentNumber.get(String(record.studentNumber))
      }

      if (!match) {
        result.unmatched += 1
        if (result.errors.length < MAX_ISSUE_MESSAGES) {
          result.errors.push(`Record ${i + 1}: no submission in cycle matched submissionId=${record.submissionId || '—'}, submissionIdInt=${record.submissionIdInt ?? '—'}, studentNumber=${record.studentNumber ?? '—'}`)
        }
        continue
      }

      result.matched += 1

      if (record.studentNumber != null && match.studentNumber && String(record.studentNumber) !== match.studentNumber) {
        if (result.warnings.length < MAX_ISSUE_MESSAGES) {
          result.warnings.push(`Record ${i + 1} (${match.submissionId}): student number ${record.studentNumber} differs from application value ${match.studentNumber}`)
        }
      }
      if (record.cumulativeGpa != null && (record.cumulativeGpa < 0 || record.cumulativeGpa > 5)) {
        if (result.warnings.length < MAX_ISSUE_MESSAGES) {
          result.warnings.push(`Record ${i + 1} (${match.submissionId}): cumulativeGpa ${record.cumulativeGpa} outside expected 0–5 range`)
        }
      }
      if (record.quartersAvailable != null && record.quartersAvailable < 0) {
        if (result.warnings.length < MAX_ISSUE_MESSAGES) {
          result.warnings.push(`Record ${i + 1} (${match.submissionId}): negative quartersAvailable ${record.quartersAvailable}`)
        }
      }

      operations.push({
        updateOne: {
          filter: { cycleId: upload.cycleId, submissionId: match.submissionId },
          update: {
            $set: {
              submissionIdInt: record.submissionIdInt ?? match.submissionIdInt,
              dpscd: {
                studentNumber: record.studentNumber,
                quartersAvailable: record.quartersAvailable,
                cumulativeGpa: record.cumulativeGpa,
                gpaStatus: record.gpaStatus,
                yearEnd: record.yearEnd,
                gradeLevel: record.gradeLevel,
                middleSchoolNumber: record.middleSchoolNumber,
                projectName: record.projectName,
                submissionStatus: record.submissionStatus,
                stageName: record.stageName,
                acceptingHighSchool: record.acceptingHighSchool,
                acceptingHighSchoolNumber: record.acceptingHighSchoolNumber,
                completedAt: record.completedAt,
                importJobId: jobId,
                importedAt,
                extra: record.extra
              }
            },
            $setOnInsert: { cycleId: upload.cycleId, submissionId: match.submissionId }
          },
          upsert: true
        }
      })
    }

    await setProgress({ phase: 'writing', total: operations.length, processed: 0, message: `Writing ${operations.length} GPA records` })
    for (let i = 0; i < operations.length; i += 500) {
      const batch = operations.slice(i, i + 500)
      const written = await GpaRecordModel.bulkWrite(batch)
      result.inserted += written.upsertedCount
      result.updated += written.modifiedCount
      await setProgress({ processed: Math.min(i + 500, operations.length) })
    }
    result.processed = records.length

    await GpaUploadModel.findByIdAndUpdate(upload._id, {
      $set: { status: 'completed', result: { ...result, errors: result.errors.slice(0, MAX_ISSUE_MESSAGES), warnings: result.warnings.slice(0, MAX_ISSUE_MESSAGES) }, records: [], error: undefined }
    })
    await setProgress({ phase: 'completed', processed: records.length, total: records.length, percent: 100, message: `DPSCD GPA import complete: ${result.matched} matched, ${result.unmatched} unmatched` })
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await GpaUploadModel.findByIdAndUpdate(upload._id, { $set: { status: 'failed', error: message } })
    throw error
  }
}

// ---------------------------------------------------------------------------
// Opt-In XLSX ingestion
// ---------------------------------------------------------------------------

export interface OptInRow {
  rowNumber: number
  submissionIdInt?: number
  studentName: string
  firstName: string
  lastName: string
  dob?: Date
  enrolledMinTerms: 'yes' | 'no' | ''
  enrolledMinTermsFlag: boolean
  termsEnrolled?: number
  cumulativeGpa?: number
}

export interface OptInFile {
  fileName: string
  schoolName: string
  rows: OptInRow[]
  errors: string[]
}

const OPTIN_COLUMNS = {
  submissionId: /submission\s*id/i,
  studentName: /student\s*name/i,
  firstName: /first\s*name/i,
  lastName: /last\s*name/i,
  dob: /date\s*of\s*birth|dob/i,
  enrolled: /enrolled.*(3\s*semesters|4\s*trimesters)/i,
  terms: /how\s*many\s*terms/i,
  gpa: /cumulative.*gpa/i
}

function excelSerialToDate(serial: number): Date | undefined {
  if (!Number.isFinite(serial) || serial <= 0) return undefined
  const date = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function parseDobCell(value: unknown): Date | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value
  if (typeof value === 'number') return excelSerialToDate(value)
  if (value == null) return undefined
  const text = String(value).trim()
  if (!text) return undefined
  if (/^\d+(\.\d+)?$/.test(text)) return excelSerialToDate(Number(text))
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function findHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i] || []
    if (row.some(cell => OPTIN_COLUMNS.submissionId.test(String(cell ?? '')))) return i
  }
  return -1
}

export function parseOptInXlsx(fileName: string, content: Buffer): OptInFile {
  const workbook = XLSX.read(content, { type: 'buffer', cellDates: true })
  const file: OptInFile = { fileName, schoolName: '', rows: [], errors: [] }
  const sheet = workbook.Sheets[workbook.SheetNames[0]!]
  if (!sheet) {
    file.errors.push(`${fileName}: no worksheets found`)
    return file
  }

  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' })
  for (const row of grid) {
    for (const cell of row) {
      const text = String(cell ?? '').trim()
      const match = /^school\s*name\s*:\s*(.+)$/i.exec(text)
      if (match) file.schoolName = match[1]!.trim()
    }
  }

  const headerIndex = findHeaderRow(grid)
  if (headerIndex < 0) {
    file.errors.push(`${fileName}: could not find a header row containing SubmissionID`)
    return file
  }

  const headers = (grid[headerIndex] || []).map(cell => String(cell ?? ''))
  const columnIndex = (pattern: RegExp) => headers.findIndex(header => pattern.test(header))
  const col = {
    submissionId: columnIndex(OPTIN_COLUMNS.submissionId),
    studentName: columnIndex(OPTIN_COLUMNS.studentName),
    firstName: columnIndex(OPTIN_COLUMNS.firstName),
    lastName: columnIndex(OPTIN_COLUMNS.lastName),
    dob: columnIndex(OPTIN_COLUMNS.dob),
    enrolled: columnIndex(OPTIN_COLUMNS.enrolled),
    terms: columnIndex(OPTIN_COLUMNS.terms),
    gpa: columnIndex(OPTIN_COLUMNS.gpa)
  }
  if (col.submissionId < 0 || col.gpa < 0) {
    file.errors.push(`${fileName}: missing required SubmissionID or GPA column`)
    return file
  }

  const cellText = (row: unknown[], index: number) => (index >= 0 ? String(row[index] ?? '').trim() : '')
  const cellNum = (row: unknown[], index: number) => (index >= 0 ? toFloat(row[index]) : undefined)

  for (let i = headerIndex + 1; i < grid.length; i++) {
    const row = grid[i] || []
    const submissionIdInt = col.submissionId >= 0 ? toInt(row[col.submissionId]) : undefined
    const studentName = cellText(row, col.studentName)
    const firstName = cellText(row, col.firstName)
    const lastName = cellText(row, col.lastName)
    if (submissionIdInt == null && !studentName && !firstName && !lastName) continue

    const enrolledRaw = cellText(row, col.enrolled).toLowerCase()
    const enrolledMinTerms = enrolledRaw === 'yes' ? 'yes' : enrolledRaw === 'no' ? 'no' : ''
    file.rows.push({
      rowNumber: i + 1,
      submissionIdInt,
      studentName,
      firstName,
      lastName,
      dob: col.dob >= 0 ? parseDobCell(row[col.dob]) : undefined,
      enrolledMinTerms: enrolledMinTerms as 'yes' | 'no' | '',
      enrolledMinTermsFlag: enrolledMinTerms === 'yes',
      termsEnrolled: cellNum(row, col.terms),
      cumulativeGpa: cellNum(row, col.gpa)
    })
  }

  return file
}

export type OptInRowStatus = 'matched' | 'missing_optin_label' | 'unmatched' | 'invalid_gpa' | 'not_enrolled'

export interface OptInPreviewRow {
  file: string
  row: number
  submissionIdInt?: number
  studentName: string
  submissionName?: string
  cumulativeGpa?: number
  status: OptInRowStatus
  warnings: string[]
}

export interface OptInPreview {
  files: number
  processed: number
  matched: number
  missingOptInLabel: number
  unmatched: number
  invalidGpa: number
  notEnrolled: number
  optInMissingFromFile: number
  optInLabelResolved: boolean
  rows: OptInPreviewRow[]
  errors: string[]
}

interface OptInMatchContext {
  optInLabelId?: string
  byInt: Map<number, { submissionId: string, fullName: string, hasOptIn: boolean }>
}

async function loadOptInMatchContext(
  cycleId: string,
  setProgress: ProgressFn,
  clientConfig?: SubmittableClientConfig
): Promise<OptInMatchContext> {
  const missingLabels = await SubmissionModel.countDocuments({ cycleId, labelIds: { $exists: false } })
  if (missingLabels > 0) {
    await setProgress({ phase: 'syncing_labels', message: 'Backfilling submission labels from Submittable' })
    await syncSubmissionLabels(cycleId, setProgress, clientConfig)
  }

  const [optInLabelId, submissions] = await Promise.all([
    resolveOptInLabelId(),
    SubmissionModel.find({ cycleId }).select('submissionId submissionIdInt labelIds mappedFields.FullName mappedFields.FirstName mappedFields.LastName').lean()
  ])

  const byInt = new Map<number, { submissionId: string, fullName: string, hasOptIn: boolean }>()
  for (const sub of submissions) {
    const labelIds = (sub as { labelIds?: string[] }).labelIds || []
    const hasOptIn = optInLabelId ? labelIds.includes(optInLabelId) : false
    if (sub.submissionIdInt != null) {
      const mapped = (sub.mappedFields || {}) as Record<string, unknown>
      const fullName = String(mapped.FullName || `${mapped.FirstName || ''} ${mapped.LastName || ''}`.trim())
      byInt.set(sub.submissionIdInt, { submissionId: sub.submissionId, fullName, hasOptIn })
    }
  }
  return { optInLabelId, byInt }
}

function classifyOptInRow(
  row: OptInRow,
  context: OptInMatchContext
): { status: OptInRowStatus, warnings: string[], match?: { submissionId: string, fullName: string, hasOptIn: boolean } } {
  const warnings: string[] = []
  if (row.submissionIdInt == null) {
    return { status: 'unmatched', warnings: ['missing SubmissionID'] }
  }
  const match = context.byInt.get(row.submissionIdInt)
  if (!match) {
    return { status: 'unmatched', warnings: ['no submission found for SubmissionID'] }
  }
  if (row.cumulativeGpa == null || row.cumulativeGpa < 0 || row.cumulativeGpa > 5) {
    return { status: 'invalid_gpa', warnings: [`invalid GPA value`], match }
  }
  if (!match.hasOptIn) {
    warnings.push('submission does not have the Opt-In label')
    return { status: 'missing_optin_label', warnings, match }
  }
  if (row.enrolledMinTerms !== 'yes') {
    warnings.push(row.enrolledMinTerms === 'no' ? `enrolled fewer than minimum terms (${row.termsEnrolled ?? '?'})` : 'enrollment duration not answered')
    return { status: 'not_enrolled', warnings, match }
  }
  return { status: 'matched', warnings, match }
}

export async function previewOptInGpaUpload(
  uploadId: string,
  setProgress: ProgressFn,
  clientConfig?: SubmittableClientConfig
): Promise<OptInPreview> {
  const upload = await GpaUploadModel.findOne({ _id: uploadId, source: 'opt_in', status: 'previewing' })
  if (!upload) throw new Error('Staged Opt-In GPA upload is unavailable for preview')

  const preview: OptInPreview = {
    files: upload.files.length,
    processed: 0,
    matched: 0,
    missingOptInLabel: 0,
    unmatched: 0,
    invalidGpa: 0,
    notEnrolled: 0,
    optInMissingFromFile: 0,
    optInLabelResolved: false,
    rows: [],
    errors: []
  }

  try {
    const files: OptInFile[] = []
    for (let i = 0; i < upload.files.length; i++) {
      const stored = upload.files[i]!
      const parsed = parseOptInXlsx(stored.name, Buffer.from(stored.content, 'base64'))
      files.push(parsed)
      preview.errors.push(...parsed.errors)
      preview.processed += parsed.rows.length
      await setProgress({ phase: 'parsing', total: upload.files.length + 1, processed: i + 1, message: `Parsed ${i + 1} of ${upload.files.length} files` })
    }

    await setProgress({ phase: 'matching', total: upload.files.length + 1, processed: upload.files.length, message: 'Matching rows to submissions' })
    const context = await loadOptInMatchContext(upload.cycleId, setProgress, clientConfig)
    preview.optInLabelResolved = Boolean(context.optInLabelId)
    if (!context.optInLabelId) {
      preview.errors.push('Could not resolve an "Opt-In" label from synced metadata — label warnings may be inaccurate')
    }

    const fileIdInts = new Set<number>()
    for (const file of files) {
      for (const row of file.rows) {
        const { status, warnings, match } = classifyOptInRow(row, context)
        if (row.submissionIdInt != null) fileIdInts.add(row.submissionIdInt)
        if (status === 'matched') preview.matched += 1
        else if (status === 'missing_optin_label') preview.missingOptInLabel += 1
        else if (status === 'unmatched') preview.unmatched += 1
        else if (status === 'invalid_gpa') preview.invalidGpa += 1
        else if (status === 'not_enrolled') preview.notEnrolled += 1
        preview.rows.push({
          file: file.fileName,
          row: row.rowNumber,
          submissionIdInt: row.submissionIdInt,
          studentName: row.studentName || `${row.firstName} ${row.lastName}`.trim(),
          submissionName: match?.fullName,
          cumulativeGpa: row.cumulativeGpa,
          status,
          warnings
        })
      }
    }

    for (const [intId, entry] of context.byInt) {
      if (entry.hasOptIn && !fileIdInts.has(intId)) preview.optInMissingFromFile += 1
    }

    await GpaUploadModel.findByIdAndUpdate(upload._id, { $set: { status: 'ready', preview: preview as unknown as Record<string, unknown>, error: undefined } })
    await setProgress({ phase: 'completed', processed: upload.files.length + 1, total: upload.files.length + 1, percent: 100, message: 'Preview complete' })
    return preview
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await GpaUploadModel.findByIdAndUpdate(upload._id, { $set: { status: 'failed', error: message } })
    throw error
  }
}

export interface OptInCommitResult {
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

export async function commitOptInGpaUpload(
  uploadId: string,
  setProgress: ProgressFn,
  clientConfig?: SubmittableClientConfig
): Promise<OptInCommitResult> {
  const upload = await GpaUploadModel.findOne({ _id: uploadId, source: 'opt_in', status: 'confirming' })
  if (!upload) throw new Error('Staged Opt-In GPA upload is unavailable for import')

  const result: OptInCommitResult = { processed: 0, updated: 0, inserted: 0, skippedUnmatched: 0, skippedInvalid: 0, missingOptInLabel: 0, notEnrolled: 0, warnings: [], errors: [] }

  try {
    const files: OptInFile[] = []
    for (let i = 0; i < upload.files.length; i++) {
      const stored = upload.files[i]!
      const parsed = parseOptInXlsx(stored.name, Buffer.from(stored.content, 'base64'))
      files.push(parsed)
      result.errors.push(...parsed.errors)
      await setProgress({ phase: 'parsing', total: upload.files.length + 1, processed: i + 1, message: `Parsed ${i + 1} of ${upload.files.length} files` })
    }

    const context = await loadOptInMatchContext(upload.cycleId, setProgress, clientConfig)
    const importedAt = new Date()
    const operations: AnyBulkWriteOperation<GpaRecord>[] = []

    for (const file of files) {
      for (const row of file.rows) {
        result.processed += 1
        const { status, match } = classifyOptInRow(row, context)
        if (!match) {
          result.skippedUnmatched += 1
          continue
        }
        if (status === 'invalid_gpa') {
          result.skippedInvalid += 1
          if (result.warnings.length < MAX_ISSUE_MESSAGES) {
            result.warnings.push(`${file.fileName} row ${row.rowNumber}: skipped invalid GPA for submission ${match.submissionId}`)
          }
          continue
        }
        if (status === 'missing_optin_label') {
          result.missingOptInLabel += 1
          if (result.warnings.length < MAX_ISSUE_MESSAGES) {
            result.warnings.push(`${file.fileName} row ${row.rowNumber}: submission ${match.submissionId} lacks the Opt-In label`)
          }
        }
        if (status === 'not_enrolled') result.notEnrolled += 1

        operations.push({
          updateOne: {
            filter: { cycleId: upload.cycleId, submissionId: match.submissionId },
            update: {
              $set: {
                submissionIdInt: row.submissionIdInt,
                optIn: {
                  studentName: row.studentName || `${row.firstName} ${row.lastName}`.trim(),
                  firstName: row.firstName,
                  lastName: row.lastName,
                  dob: row.dob,
                  enrolledMinTerms: row.enrolledMinTerms,
                  enrolledMinTermsFlag: row.enrolledMinTermsFlag,
                  termsEnrolled: row.termsEnrolled,
                  cumulativeGpa: row.cumulativeGpa,
                  schoolName: file.schoolName,
                  sourceFile: file.fileName,
                  uploadId: String(upload._id),
                  importedAt
                }
              },
              $setOnInsert: { cycleId: upload.cycleId, submissionId: match.submissionId }
            },
            upsert: true
          }
        })
      }
    }

    await setProgress({ phase: 'writing', processed: upload.files.length, message: `Writing ${operations.length} Opt-In GPA records` })
    for (let i = 0; i < operations.length; i += 500) {
      const written = await GpaRecordModel.bulkWrite(operations.slice(i, i + 500))
      result.inserted += written.upsertedCount
      result.updated += written.modifiedCount
    }

    await GpaUploadModel.findByIdAndUpdate(upload._id, {
      $set: { status: 'completed', result: result as unknown as Record<string, unknown>, files: [], error: undefined }
    })
    await setProgress({ phase: 'completed', processed: upload.files.length + 1, total: upload.files.length + 1, percent: 100, message: 'Opt-In GPA import complete' })
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await GpaUploadModel.findByIdAndUpdate(upload._id, { $set: { status: 'failed', error: message } })
    throw error
  }
}
