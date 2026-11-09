import { ApplicationModel } from '../models/Application'
import { ReviewModel, type Review } from '../models/Review'
import { SubmissionModel } from '../models/Submission'
import type { ProgressFn } from './validation'

// ---------------------------------------------------------------------------
// EHS Registration sync
//
// Upserts exam-type submissions into the external EHS Registration database via
// its REST API (GET /api/external/students + POST /api/external/students/upsert,
// authenticated with an `x-api-key` header).
//
// Withdrawn submissions are removed via POST /api/external/students/delete.
// Match key: submissionIdUnique <- Submission.submissionId (Submittable UUID).
// CheckIn / CheckOut / TestSession are live registration fields owned by the
// external system: they are only ever sent as "" on initial insert, never on
// updates. Empty local values are never sent to overwrite remote values.
// ---------------------------------------------------------------------------

export const REGISTRATION_DEFAULT_BASE_URL = 'https://ehs-registration-v2.netlify.app'
const UPSERT_CHUNK_SIZE = 500

interface RemoteStudent {
  _id?: string
  SubmissionID?: string
  submissionIdUnique?: string
  FullName?: string
  FirstName?: string
  LastName?: string
  IEP?: string
  Accommodations?: string
  CheckIn?: unknown
  CheckOut?: unknown
  TestSession?: unknown
}

interface LocalStudent {
  SubmissionID: string
  submissionIdUnique: string
  FullName: string
  FirstName: string
  LastName: string
  IEP: string
  Accommodations?: string
}

interface DeleteResponse {
  requested?: number
  deleted?: number
  notFound?: string[]
}

interface UpsertResponse {
  matched?: number
  modified?: number
  inserted?: number
  errors?: { index: number, message: string }[]
}

export interface RegistrationSyncResult {
  submissions: number
  remote: number
  inserts: number
  updates: number
  unchanged: number
  matched: number
  modified: number
  inserted: number
  deletes: { submissionIdUnique: string, name: string }[]
  deleted: number
  deleteNotFound: string[]
  errors: { index: number, submissionIdUnique?: string, message: string }[]
  dryRun: boolean
}

export function sanitizeAccommodations(value: unknown): string {
  return String(value ?? '')
    .replace(/\//g, ' ')
    .replace(/</g, ' less than ')
    .replace(/>/g, ' greater than ')
    .replace(/\s+/g, ' ')
    .trim()
}

function latestCompleted(reviews: Review[]): Review | undefined {
  return reviews
    .filter(review => review.completedAt || review.status?.toLowerCase() === 'completed')
    .sort((a, b) => (b.completedAt?.getTime() || 0) - (a.completedAt?.getTime() || 0))[0]
}

function resolveIepAndAccommodations(reviews: Review[]): { IEP: string, Accommodations?: string } {
  const iepReview = latestCompleted(reviews.filter(review => /iep\s*review|504\s*review/i.test(review.stageName || '')))
  const iepAccommodations = sanitizeAccommodations(iepReview?.mappedData?.Accommodations)
  if (iepAccommodations) return { IEP: 'Yes', Accommodations: iepAccommodations }

  const mllReview = latestCompleted(reviews.filter(review => /mll\s*review/i.test(review.stageName || '')))
  const mllAccommodations = sanitizeAccommodations(mllReview?.mappedData?.MLLAccommodations ?? mllReview?.mappedData?.Accommodations)
  if (mllAccommodations) return { IEP: 'MLL', Accommodations: mllAccommodations }

  return { IEP: 'No' }
}

function diffUpdate(local: LocalStudent, remote: RemoteStudent): Record<string, string> | undefined {
  const update: Record<string, string> = { submissionIdUnique: local.submissionIdUnique }
  let changed = false
  for (const field of ['SubmissionID', 'FullName', 'FirstName', 'LastName', 'IEP', 'Accommodations'] as const) {
    const next = local[field]
    if (next == null || next === '') continue
    if (String(remote[field] ?? '') !== next) {
      update[field] = next
      changed = true
    }
  }
  return changed ? update : undefined
}

async function registrationRequest<T>(path: string, baseUrl: string, apiKey: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'x-api-key': apiKey, ...options.headers }
  })
  if (response.status === 401) {
    throw new Error('EHS Registration API returned 401 Unauthorized — check NUXT_REGISTRATION_API_KEY')
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`EHS Registration API ${options.method || 'GET'} ${path} failed with ${response.status}${body ? `: ${body.slice(0, 500)}` : ''}`)
  }
  return await response.json() as T
}

export async function runRegistrationSync(options: {
  cycleId: string
  setProgress?: ProgressFn
  dryRun?: boolean
  apiKey?: string
  baseUrl?: string
}): Promise<RegistrationSyncResult> {
  const { cycleId, setProgress, dryRun = false } = options
  const config = useRuntimeConfig()
  const apiKey = options.apiKey || config.registrationApiKey
  if (!apiKey) throw new Error('NUXT_REGISTRATION_API_KEY is not configured')
  const baseUrl = (options.baseUrl || config.registrationBaseUrl || REGISTRATION_DEFAULT_BASE_URL).replace(/\/+$/, '')

  await setProgress?.({ phase: 'loading', message: 'Loading submissions and reviews', total: 0, processed: 0, percent: 0 })

  const applications = await ApplicationModel.find({ cycleId, type: 'exam' }).select('_id').lean()
  const applicationIds = applications.map(application => String(application._id))
  const submissions = await SubmissionModel.find({ cycleId, applicationId: { $in: applicationIds } })
    .select('submissionId submissionIdInt applicationId status mappedFields')
    .lean()
  const isWithdrawn = (status: string | undefined) => status?.toLowerCase() === 'withdrawn'
  const active = submissions.filter(submission => !isWithdrawn(submission.status))
  const withdrawn = submissions.filter(submission => isWithdrawn(submission.status))

  const reviews = await ReviewModel.find({ cycleId, submissionId: { $in: active.map(s => s.submissionId) } })
    .select('submissionId stageName status completedAt mappedData')
    .lean()
  const reviewsBySubmission = new Map<string, Review[]>()
  for (const review of reviews) {
    const list = reviewsBySubmission.get(review.submissionId) || []
    list.push(review)
    reviewsBySubmission.set(review.submissionId, list)
  }

  const localStudents: LocalStudent[] = []
  for (const submission of active) {
    const mapped = submission.mappedFields || {}
    const { IEP, Accommodations } = resolveIepAndAccommodations(reviewsBySubmission.get(submission.submissionId) || [])
    const student: LocalStudent = {
      submissionIdUnique: submission.submissionId,
      SubmissionID: submission.submissionIdInt != null ? String(submission.submissionIdInt) : '',
      FirstName: String(mapped.FirstName ?? '').trim(),
      LastName: String(mapped.LastName ?? '').trim(),
      FullName: String(mapped.FullName ?? `${mapped.FirstName ?? ''} ${mapped.LastName ?? ''}`).trim(),
      IEP,
      ...(Accommodations ? { Accommodations } : {})
    }
    localStudents.push(student)
  }

  await setProgress?.({ phase: 'reading_remote', message: 'Reading existing students from registration API', total: 0, processed: 0 })

  const remoteStudents = await registrationRequest<RemoteStudent[]>('/api/external/students', baseUrl, apiKey)
  const remoteByUniqueId = new Map<string, RemoteStudent>()
  for (const remote of Array.isArray(remoteStudents) ? remoteStudents : []) {
    if (remote.submissionIdUnique) remoteByUniqueId.set(remote.submissionIdUnique, remote)
  }

  const inserts: Record<string, unknown>[] = []
  const updates: Record<string, string>[] = []
  let unchanged = 0
  for (const local of localStudents) {
    const remote = remoteByUniqueId.get(local.submissionIdUnique)
    if (!remote) {
      inserts.push({ ...local, CheckIn: '', CheckOut: '', TestSession: '' })
      continue
    }
    const update = diffUpdate(local, remote)
    if (update) updates.push(update)
    else unchanged += 1
  }

  const deleteIds = withdrawn.map(submission => submission.submissionId).filter(Boolean)
  const result: RegistrationSyncResult = {
    submissions: localStudents.length,
    remote: remoteByUniqueId.size,
    inserts: inserts.length,
    updates: updates.length,
    unchanged,
    matched: 0,
    modified: 0,
    inserted: 0,
    deletes: withdrawn.map(submission => ({
      submissionIdUnique: submission.submissionId,
      name: String(submission.mappedFields?.FullName ?? `${submission.mappedFields?.FirstName ?? ''} ${submission.mappedFields?.LastName ?? ''}`).trim()
    })),
    deleted: 0,
    deleteNotFound: [],
    errors: [],
    dryRun
  }

  const outgoing = [...inserts, ...updates]
  const totalChunks = Math.ceil(outgoing.length / UPSERT_CHUNK_SIZE)
  for (let index = 0; index < outgoing.length; index += UPSERT_CHUNK_SIZE) {
    const chunk = outgoing.slice(index, index + UPSERT_CHUNK_SIZE)
    const chunkNumber = index / UPSERT_CHUNK_SIZE + 1
    await setProgress?.({
      phase: 'writing',
      message: `Upserting chunk ${chunkNumber} / ${totalChunks} (${chunk.length} records)`,
      total: outgoing.length,
      processed: index,
      percent: Math.round((index / Math.max(outgoing.length, 1)) * 100)
    })
    if (dryRun) continue
    const response = await registrationRequest<UpsertResponse>('/api/external/students/upsert', baseUrl, apiKey, {
      method: 'POST',
      body: JSON.stringify(chunk)
    })
    result.matched += response.matched || 0
    result.modified += response.modified || 0
    result.inserted += response.inserted || 0
    for (const error of response.errors || []) {
      const record = chunk[error.index] as { submissionIdUnique?: string } | undefined
      result.errors.push({ index: index + error.index, submissionIdUnique: record?.submissionIdUnique, message: error.message })
    }
  }

  for (let index = 0; index < deleteIds.length; index += UPSERT_CHUNK_SIZE) {
    const chunk = deleteIds.slice(index, index + UPSERT_CHUNK_SIZE)
    await setProgress?.({
      phase: 'deleting',
      message: `Deleting ${chunk.length} withdrawn registrations (${Math.min(index + UPSERT_CHUNK_SIZE, deleteIds.length)} / ${deleteIds.length})`,
      total: outgoing.length + deleteIds.length,
      processed: outgoing.length + index
    })
    if (dryRun) continue
    const response = await registrationRequest<DeleteResponse>('/api/external/students/delete', baseUrl, apiKey, {
      method: 'POST',
      body: JSON.stringify(chunk)
    })
    result.deleted += response.deleted || 0
    result.deleteNotFound.push(...(response.notFound || []))
  }

  await setProgress?.({
    phase: 'completed',
    message: `Registration sync${dryRun ? ' (dry run)' : ''}: ${result.inserts} inserts, ${result.updates} updates, ${unchanged} unchanged, ${result.deletes.length} deletions`,
    total: outgoing.length,
    processed: outgoing.length,
    percent: 100
  })

  return result
}
