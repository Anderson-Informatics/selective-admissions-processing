import { isWithdrawnSubmission } from './submissionStatus'

export type ExamEntrance = 'Main Entrance' | 'Performing Arts'

export interface ExamGroupDef {
  key: string
  name: string
  examLetter?: string
  colorKey?: 'green' | 'blue' | 'white' | 'red'
  entrance: ExamEntrance
  arrivalTime: string
  /** Participates in min/max balancing for the general pool. */
  schedulable?: boolean
  /** Overflow bucket used when all schedulable groups are at max. */
  overflow?: boolean
}

export const EXAM_GROUP_DEFS: ExamGroupDef[] = [
  { key: 'RED', name: 'IEP/504 – Review Incomplete', colorKey: 'red', entrance: 'Performing Arts', arrivalTime: '8:30 a.m.' },
  { key: 'IEP504', name: 'IEP/504', colorKey: 'white', entrance: 'Performing Arts', arrivalTime: '8:30 a.m.' },
  { key: 'MLL', name: 'MLL', colorKey: 'white', entrance: 'Main Entrance', arrivalTime: '8:30 a.m.' },
  { key: 'A-green', name: 'Exam A — Green (Main)', examLetter: 'A', colorKey: 'green', entrance: 'Main Entrance', arrivalTime: '9:00 a.m.', schedulable: true },
  { key: 'A-blue', name: 'Exam A — Blue (Performing Arts)', examLetter: 'A', colorKey: 'blue', entrance: 'Performing Arts', arrivalTime: '9:00 a.m.', schedulable: true },
  { key: 'B-green', name: 'Exam B — Green (Main)', examLetter: 'B', colorKey: 'green', entrance: 'Main Entrance', arrivalTime: '9:20 a.m.', schedulable: true },
  { key: 'B-blue', name: 'Exam B — Blue (Performing Arts)', examLetter: 'B', colorKey: 'blue', entrance: 'Performing Arts', arrivalTime: '9:20 a.m.', schedulable: true },
  { key: 'C-green', name: 'Exam C — Green (Main)', examLetter: 'C', colorKey: 'green', entrance: 'Main Entrance', arrivalTime: '9:40 a.m.', schedulable: true },
  { key: 'C-blue', name: 'Exam C — Blue (Performing Arts)', examLetter: 'C', colorKey: 'blue', entrance: 'Performing Arts', arrivalTime: '9:40 a.m.', schedulable: true },
  { key: 'D', name: 'Exam D (Performing Arts)', examLetter: 'D', entrance: 'Performing Arts', arrivalTime: '10:00 a.m.', schedulable: true },
  { key: 'E', name: 'Exam E (Performing Arts)', examLetter: 'E', entrance: 'Performing Arts', arrivalTime: '10:20 a.m.', schedulable: true },
  { key: 'F', name: 'Exam F (Performing Arts)', examLetter: 'F', entrance: 'Performing Arts', arrivalTime: '10:40 a.m.', schedulable: true },
  { key: 'G', name: 'Exam G (Performing Arts)', examLetter: 'G', entrance: 'Performing Arts', arrivalTime: '11:00 a.m.', schedulable: true },
  { key: 'H', name: 'Exam H — Overflow (Performing Arts)', examLetter: 'H', entrance: 'Performing Arts', arrivalTime: '11:20 a.m.', overflow: true }
]

export const DEFAULT_COLOR_LABELS: Record<'green' | 'blue' | 'white' | 'red', string> = {
  green: '00-Green',
  blue: '00-Blue',
  white: '00-White',
  red: '00-Red'
}

export interface ExamGroupBounds {
  min: number
  max: number
  note?: string
}

export interface ExamScheduleRecord {
  sessionLabelId: string
  sessionName: string
  generatedAt: string
  assignments: Record<string, string>
}

export interface ExamSchedulingConfig {
  sessionLabelPattern: string
  /** Regex with a single capture group for the exam letter, used to detect pre-assigned submissions. */
  examLabelPattern: string
  examLabelTemplate: string
  iep504LabelIds: string[]
  mllLabelId?: string
  /** Regex matched against reviewCompletion ledger stage names and review stageName values. */
  iepReviewStagePattern: string
  noAccommodationsValue: string
  messageTemplateId?: string
  testSubmissionId?: string
  colorLabels: Record<'green' | 'blue' | 'white' | 'red', string>
  groups: Record<string, ExamGroupBounds>
  schedules: Record<string, ExamScheduleRecord>
}

export const DEFAULT_TEST_SUBMISSION_ID = 'f855c80a-798b-4c4e-bdc7-8e04cae87f12'

export function normalizeExamSchedulingConfig(raw?: Record<string, unknown> | null): ExamSchedulingConfig {
  const input = raw || {}
  const groups: Record<string, ExamGroupBounds> = {}
  const rawGroups = (input.groups && typeof input.groups === 'object' ? input.groups : {}) as Record<string, Record<string, unknown>>
  for (const def of EXAM_GROUP_DEFS) {
    const raw = rawGroups[def.key] || {}
    const defaults = def.schedulable
      ? (def.examLetter === 'A' ? { min: 50, max: 70 } : { min: 60, max: 80 })
      : { min: 0, max: 0 }
    groups[def.key] = {
      min: Number.isFinite(Number(raw.min)) ? Math.max(0, Number(raw.min)) : defaults.min,
      max: Number.isFinite(Number(raw.max)) ? Math.max(0, Number(raw.max)) : defaults.max,
      ...(typeof raw.note === 'string' && raw.note ? { note: raw.note } : {})
    }
  }
  const rawColors = (input.colorLabels && typeof input.colorLabels === 'object' ? input.colorLabels : {}) as Record<string, unknown>
  const colorLabels = { ...DEFAULT_COLOR_LABELS } as ExamSchedulingConfig['colorLabels']
  for (const key of Object.keys(colorLabels) as Array<keyof typeof colorLabels>) {
    if (typeof rawColors[key] === 'string' && rawColors[key]) colorLabels[key] = rawColors[key] as string
  }
  return {
    sessionLabelPattern: typeof input.sessionLabelPattern === 'string' && input.sessionLabelPattern ? input.sessionLabelPattern : '^HSPT\\s+[A-Z][a-z]{2}\\s+\\d{1,2}$',
    examLabelPattern: typeof input.examLabelPattern === 'string' && input.examLabelPattern && input.examLabelPattern !== '^Exam\\s*([A-Z])$'
      ? input.examLabelPattern
      : '^Exam\\s*-\\s*([A-Z])$',
    examLabelTemplate: typeof input.examLabelTemplate === 'string' && input.examLabelTemplate && input.examLabelTemplate !== 'Exam {letter}'
      ? input.examLabelTemplate
      : 'Exam - {letter}',
    iep504LabelIds: Array.isArray(input.iep504LabelIds)
      ? input.iep504LabelIds
          .map(id => typeof id === 'string' ? id : (id && typeof id === 'object' ? String((id as { value?: unknown }).value ?? '') : ''))
          .filter(Boolean)
      : [],
    ...(typeof input.mllLabelId === 'string' && input.mllLabelId ? { mllLabelId: input.mllLabelId } : {}),
    iepReviewStagePattern: typeof input.iepReviewStagePattern === 'string' && input.iepReviewStagePattern ? input.iepReviewStagePattern : 'iep|504',
    noAccommodationsValue: typeof input.noAccommodationsValue === 'string' && input.noAccommodationsValue ? input.noAccommodationsValue : 'No Accommodations Required',
    ...(typeof input.messageTemplateId === 'string' && input.messageTemplateId ? { messageTemplateId: input.messageTemplateId } : {}),
    testSubmissionId: typeof input.testSubmissionId === 'string' && input.testSubmissionId ? input.testSubmissionId : DEFAULT_TEST_SUBMISSION_ID,
    colorLabels,
    groups,
    schedules: (input.schedules && typeof input.schedules === 'object' ? input.schedules : {}) as Record<string, ExamScheduleRecord>
  }
}

export function examLabelName(letter: string, config: ExamSchedulingConfig): string {
  return config.examLabelTemplate.replace('{letter}', letter)
}

/** All Submittable label names a group applies (exam letter label + color label). */
export function groupLabelNames(def: ExamGroupDef, config: ExamSchedulingConfig): string[] {
  const names: string[] = []
  if (def.examLetter) names.push(examLabelName(def.examLetter, config))
  if (def.colorKey) names.push(config.colorLabels[def.colorKey])
  return names
}

export interface SchedulableSubmission {
  submissionId: string
  status?: string
  labelIds?: string[]
  reviewCompletion?: Array<{ name?: string, required?: boolean, complete?: boolean }>
}

export interface ExamReviewInput {
  stageName?: string
  status?: string
  completedAt?: Date | string
  mappedData?: Record<string, unknown>
}

export interface LabelInfo {
  externalId: string
  name: string
}

export interface ExamSessionInfo {
  labelId: string
  name: string
  count: number
}

export function detectSessions(
  submissions: SchedulableSubmission[],
  labels: LabelInfo[],
  sessionLabelPattern: string
): ExamSessionInfo[] {
  let regex: RegExp
  try {
    regex = new RegExp(sessionLabelPattern, 'i')
  } catch {
    regex = /^HSPT\s+[A-Z][a-z]{2}\s+\d{1,2}$/i
  }
  const sessionLabels = labels.filter(label => regex.test(label.name))
  const counts = new Map<string, number>()
  for (const submission of submissions) {
    if (isWithdrawnSubmission(submission)) continue
    const ids = new Set(submission.labelIds || [])
    for (const label of sessionLabels) {
      if (ids.has(label.externalId)) counts.set(label.externalId, (counts.get(label.externalId) || 0) + 1)
    }
  }
  return sessionLabels
    .map(label => ({ labelId: label.externalId, name: label.name, count: counts.get(label.externalId) || 0 }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function latestCompletedReview(reviews: ExamReviewInput[], stagePattern: RegExp): ExamReviewInput | undefined {
  return reviews
    .filter(review => stagePattern.test(review.stageName || ''))
    .filter(review => Boolean(review.completedAt) || ['complete', 'completed'].includes((review.status || '').trim().toLowerCase()))
    .sort((a, b) => new Date(b.completedAt || 0).getTime() - new Date(a.completedAt || 0).getTime())[0]
}

/** Picks the special-group key for a session member, or null when they belong to the general pool. */
export function classifySpecialGroup(
  submission: SchedulableSubmission,
  reviews: ExamReviewInput[],
  config: ExamSchedulingConfig
): 'RED' | 'IEP504' | 'MLL' | null {
  const ids = new Set(submission.labelIds || [])
  const hasIep504 = config.iep504LabelIds.some(id => ids.has(id))
  const stagePattern = new RegExp(config.iepReviewStagePattern, 'i')

  if (hasIep504) {
    const ledger = submission.reviewCompletion || []
    const incomplete = ledger.some(entry => entry.required && !entry.complete && stagePattern.test(entry.name || ''))
    const hasIepStage = ledger.some(entry => stagePattern.test(entry.name || ''))
    // No ledger entry at all for an IEP/504 stage means the review trail is unknown — treat as incomplete.
    if (incomplete || !hasIepStage) return 'RED'

    const review = latestCompletedReview(reviews, stagePattern)
    const accommodations = String(review?.mappedData?.Accommodations ?? '').trim()
    if (accommodations.toLowerCase() === config.noAccommodationsValue.trim().toLowerCase()) return null
    return 'IEP504'
  }

  if (config.mllLabelId && ids.has(config.mllLabelId)) return 'MLL'
  return null
}

interface DetectedPreAssignment {
  groupKey?: string
  letter?: string
}

function detectPreAssignment(
  labelNames: string[],
  config: ExamSchedulingConfig
): DetectedPreAssignment {
  let examRegex: RegExp
  try {
    examRegex = new RegExp(config.examLabelPattern, 'i')
  } catch {
    examRegex = /^Exam\s*-\s*([A-Z])$/i
  }
  let letter: string | undefined
  for (const name of labelNames) {
    const match = examRegex.exec(name.trim())
    if (match?.[1]) {
      letter = match[1].toUpperCase()
      break
    }
  }
  if (!letter) return {}
  const def = EXAM_GROUP_DEFS.find(group => group.examLetter === letter && group.schedulable)
    || EXAM_GROUP_DEFS.find(group => group.examLetter === letter)
  if (!def) return { letter }
  if (letter >= 'A' && letter <= 'C') {
    const lowered = new Set(labelNames.map(name => name.trim().toLowerCase()))
    if (lowered.has(config.colorLabels.green.toLowerCase())) return { groupKey: `${letter}-green`, letter }
    if (lowered.has(config.colorLabels.blue.toLowerCase())) return { groupKey: `${letter}-blue`, letter }
    return { letter }
  }
  return { groupKey: def.key, letter }
}

export interface ExamAssignmentResult {
  /** group key → assigned submissionIds */
  groups: Record<string, string[]>
  /** submissionId → group key */
  assignments: Record<string, string>
  diagnostics: string[]
}

export function assignGroups(input: {
  submissions: SchedulableSubmission[]
  labels: LabelInfo[]
  reviewsBySubmission: Map<string, ExamReviewInput[]>
  sessionLabelId: string
  config: ExamSchedulingConfig
  random?: () => number
}): ExamAssignmentResult {
  const { config, sessionLabelId } = input
  const random = input.random || Math.random
  const labelNameById = new Map(input.labels.map(label => [label.externalId, label.name]))
  const diagnostics: string[] = []

  const members = input.submissions.filter(submission =>
    !isWithdrawnSubmission(submission) && (submission.labelIds || []).includes(sessionLabelId)
  )

  const groups: Record<string, string[]> = {}
  for (const def of EXAM_GROUP_DEFS) groups[def.key] = []
  const assignments: Record<string, string> = {}
  const pool: SchedulableSubmission[] = []

  const assign = (submissionId: string, groupKey: string) => {
    groups[groupKey]!.push(submissionId)
    assignments[submissionId] = groupKey
  }

  for (const submission of members) {
    const special = classifySpecialGroup(submission, input.reviewsBySubmission.get(submission.submissionId) || [], config)
    if (special) {
      assign(submission.submissionId, special)
      continue
    }
    const labelNames = (submission.labelIds || []).map(id => labelNameById.get(id) || '').filter(Boolean)
    const pre = detectPreAssignment(labelNames, config)
    if (pre.groupKey) {
      assign(submission.submissionId, pre.groupKey)
    } else {
      if (pre.letter) diagnostics.push(`${submission.submissionId}: has Exam ${pre.letter} label but no 00-Green/00-Blue label; returned to pool`)
      pool.push(submission)
    }
  }

  // Randomize the pool, fill each schedulable group to its min in order, then balance evenly to max.
  const shuffled = [...pool].sort(() => random() - 0.5)
  const schedulable = EXAM_GROUP_DEFS.filter(def => def.schedulable)
  let cursor = 0

  for (const def of schedulable) {
    const bounds = config.groups[def.key] || { min: 0, max: 0 }
    while (cursor < shuffled.length && groups[def.key]!.length < bounds.min && groups[def.key]!.length < bounds.max) {
      assign(shuffled[cursor++]!.submissionId, def.key)
    }
  }

  // Balance the overflow above each group's min: groups stay offset by their
  // min difference (mins 50/60 → balanced results like 54/64).
  while (cursor < shuffled.length) {
    const candidate = schedulable
      .filter(def => groups[def.key]!.length < (config.groups[def.key]?.max ?? 0))
      .sort((a, b) =>
        (groups[a.key]!.length - (config.groups[a.key]?.min ?? 0))
        - (groups[b.key]!.length - (config.groups[b.key]?.min ?? 0))
        || groups[a.key]!.length - groups[b.key]!.length)[0]
    if (!candidate) break
    assign(shuffled[cursor++]!.submissionId, candidate.key)
  }

  const overflow = EXAM_GROUP_DEFS.find(def => def.overflow)!
  for (; cursor < shuffled.length; cursor++) {
    assign(shuffled[cursor]!.submissionId, overflow.key)
  }
  if (groups[overflow.key]!.length) {
    diagnostics.push(`${groups[overflow.key]!.length} submission(s) overflowed to ${overflow.name}`)
  }

  for (const def of schedulable) {
    const bounds = config.groups[def.key] || { min: 0, max: 0 }
    const count = groups[def.key]!.length
    if (count < bounds.min) diagnostics.push(`${def.name}: ${count} assigned, below min ${bounds.min}`)
    if (count > bounds.max) diagnostics.push(`${def.name}: ${count} assigned, above max ${bounds.max}`)
  }

  return { groups, assignments, diagnostics }
}

/** IEP/504 + MLL label IDs from config, falling back to name matching when unconfigured. */
export function resolveSpecialLabelIds(
  config: Pick<ExamSchedulingConfig, 'iep504LabelIds' | 'mllLabelId'>,
  labels: LabelInfo[]
): { iep504Ids: Set<string>, mllId?: string } {
  if (config.iep504LabelIds.length || config.mllLabelId) {
    return { iep504Ids: new Set(config.iep504LabelIds), ...(config.mllLabelId ? { mllId: config.mllLabelId } : {}) }
  }
  const iep504Ids = new Set(labels.filter(label => /iep|504/i.test(label.name)).map(label => label.externalId))
  const mllId = labels.find(label => /^\s*mll\s*$/i.test(label.name))?.externalId
  return { iep504Ids, ...(mllId ? { mllId } : {}) }
}

const MONTH_INDEX: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
}

/** "Today" in America/Detroit at day granularity (exam dates are Detroit-local). */
function detroitToday(now: Date): Date {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Detroit', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(now)
  const get = (type: string) => Number(parts.find(part => part.type === type)?.value)
  return new Date(get('year'), get('month') - 1, get('day'))
}

/** Resolves a session label name like "HSPT Nov 21" to the next upcoming month/day (next year if already past). */
export function resolveSessionDate(sessionName: string, now: Date = new Date()): Date | null {
  const match = /([A-Za-z]{3})\s+(\d{1,2})/.exec(sessionName.replace(/^\s*HSPT\s*/i, ''))
  const month = match ? MONTH_INDEX[match[1]!.slice(0, 3).toLowerCase()] : undefined
  if (month === undefined) return null
  const day = Number(match![2])
  const today = detroitToday(now)
  let date = new Date(today.getFullYear(), month, day)
  if (date.getTime() < today.getTime()) date = new Date(today.getFullYear() + 1, month, day)
  return date
}

/** "Saturday, November 21, 2026" — used in applicant-facing messages. */
export function formatSessionDateLong(sessionName: string, now?: Date): string {
  const date = resolveSessionDate(sessionName, now)
  if (!date) return sessionName
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(date)
}

/** "11/21/2026" — used on the exam scheduling page for admin display. */
export function formatSessionDateShort(sessionName: string, now?: Date): string {
  const date = resolveSessionDate(sessionName, now)
  if (!date) return sessionName
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`
}

export interface ExamEntranceDetails {
  /** Authored markup for html-mode merge rendering. */
  html: string
  /** Plain-text variant for subjects and text-mode rendering. */
  text: string
}

const POLICY_LINE = 'Please review the following policies prior to arrival.'

export const EXAM_ENTRANCE_DETAILS: Record<ExamEntrance, ExamEntranceDetails> = {
  'Main Entrance': {
    html: `<p><strong>${POLICY_LINE}</strong></p>`
      + '<blockquote><p style="font-size: 1.15em;">You will enter the building at the <strong>Main Entrance</strong>, which is in the center of the building, where you can see the flagpoles.</p></blockquote>'
      + '<p><strong>Building Entry</strong> — Students should enter through the Main Entrance. You can enter the campus from Lafayette, McDougall or Larned. Park in the parking lot closest to the building.</p>',
    text: `${POLICY_LINE}\n\nYou will enter the building at the Main Entrance, which is in the center of the building, where you can see the flagpoles.\n\nBuilding Entry — Students should enter through the Main Entrance. You can enter the campus from Lafayette, McDougall or Larned. Park in the parking lot closest to the building.`
  },
  'Performing Arts': {
    html: `<p><strong>${POLICY_LINE}</strong></p>`
      + '<blockquote><p style="font-size: 1.15em;">You will enter the building at the <strong>Performing Arts Entrance</strong>, which is near the intersection of McDougall and Lafayette.</p></blockquote>'
      + '<p><strong>Building Entry</strong> — Students should enter through the Performing Arts entrance, near the intersection of McDougall and Lafayette. You can enter from either street. Park in the parking lot closest to the building.</p>',
    text: `${POLICY_LINE}\n\nYou will enter the building at the Performing Arts Entrance, which is near the intersection of McDougall and Lafayette.\n\nBuilding Entry — Students should enter through the Performing Arts entrance, near the intersection of McDougall and Lafayette. You can enter from either street. Park in the parking lot closest to the building.`
  }
}

export interface ExamSessionTokens {
  label: string
  arrivalTime: string
  entrance: string
  date: string
  note: string
  /** Plain-text location block; html mode renders `locationHtml` instead. */
  location: string
  locationHtml: string
}

/** Merge-token payload for a group within a session. */
export function examSessionTokens(
  groupKey: string,
  sessionName: string,
  config: ExamSchedulingConfig,
  now?: Date
): ExamSessionTokens {
  const def = EXAM_GROUP_DEFS.find(group => group.key === groupKey)
  const primaryLabel = def?.examLetter
    ? examLabelName(def.examLetter, config)
    : (def?.colorKey ? config.colorLabels[def.colorKey] : '')
  const details = def?.entrance ? EXAM_ENTRANCE_DETAILS[def.entrance] : undefined
  return {
    label: primaryLabel,
    arrivalTime: def?.arrivalTime || '',
    entrance: def?.entrance || '',
    date: formatSessionDateLong(sessionName, now),
    note: (groupKey && config.groups[groupKey]?.note) || '',
    location: details?.text || '',
    locationHtml: details?.html || ''
  }
}

/** Resolves the examSession merge payload for a submission from persisted schedules. */
export function examSessionForSubmission(
  submissionId: string,
  config: ExamSchedulingConfig,
  now?: Date
): ExamSessionTokens | undefined {
  for (const record of Object.values(config.schedules || {})) {
    const groupKey = record.assignments?.[submissionId]
    if (groupKey) return examSessionTokens(groupKey, record.sessionName, config, now)
  }
  return undefined
}
