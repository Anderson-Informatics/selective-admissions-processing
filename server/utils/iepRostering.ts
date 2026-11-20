import { assessExamMember, detectSessions, resolveExamReviews, type ExamReviewInput, type ExamReviewStage, type ExamSchedulingConfig, type LabelInfo, type SchedulableSubmission } from './examScheduling'
import { isWithdrawnSubmission } from './submissionStatus'

export interface IepRosterRow {
  submissionId: string
  submissionIdInt?: number
  sessionLabelId: string
  examDate: string
  firstName: string
  lastName: string
  fullName: string
  type: string
  completeDocuments: string
  accommodationsRequired: string
  accommodations: string
  otherAccommodations: string
  parentPhone: string
  language: string
  mllSupport: boolean
  accommodationGroup: string
  finalGroup: string
  notices: string[]
  warnings: string[]
}

const text = (value: unknown): string => Array.isArray(value) ? value.map(text).filter(Boolean).join('; ') : value == null ? '' : String(value).trim()
const normalized = (value: unknown) => text(value).replace(/\s+/g, ' ').toLowerCase()
const answer = (value: unknown) => ['yes', 'no'].includes(normalized(value)) ? (normalized(value) === 'yes' ? 'Yes' : 'No') : ''
const join = (values: unknown[]) => [...new Set(values.map(text).filter(Boolean))].join('; ')
export const compareRosterNames = (a: IepRosterRow, b: IepRosterRow) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName) || a.submissionId.localeCompare(b.submissionId)

export function accommodationGroup(accommodations: string, mllSupport: boolean, language: string, noAccommodationsValue: string): string {
  const value = normalized(accommodations).replace(/text-to-speech/g, 'text to speech')
  if (/scribe|human reader/.test(value)) return 'Group I'
  if (mllSupport || /english language learner|\bmll\b|bilingual/.test(value)) return `Group F - ${normalized(language) || 'unknown language'}`
  const tts = /text to speech|read aloud/.test(value)
  const extended = /extended time|extra time/.test(value)
  if (tts) return extended ? 'Group B' : 'Group A'
  if (extended) return /break/.test(value) ? 'Group C' : 'Group D'
  if (/small group|other/.test(value)) return 'Group G'
  if (value && (value === normalized(noAccommodationsValue) || /^no accommodations (?:are )?required$/.test(value))) return 'No Accommodations'
  return value ? 'Group G' : 'No Group Assigned'
}

function smallLimit(row: IepRosterRow) {
  const value = normalized(row.accommodations)
  return /small group less than 5/.test(value) ? 7 : /small group less than 10/.test(value) ? 12 : undefined
}

export function splitAccommodationGroups(input: IepRosterRow[]): IepRosterRow[] {
  const rows = input.map(row => ({ ...row, finalGroup: row.accommodationGroup })).sort(compareRosterNames)
  const buckets = new Map<string, IepRosterRow[]>()
  for (const row of rows) {
    const key = JSON.stringify([row.sessionLabelId, row.accommodationGroup])
    const bucket = buckets.get(key) || []
    bucket.push(row)
    buckets.set(key, bucket)
  }
  for (const bucket of buckets.values()) {
    if (!bucket[0]!.accommodationGroup.startsWith('Group ')) continue
    const limits = bucket.map(smallLimit).filter((value): value is 7 | 12 => value !== undefined)
    if (!limits.length) continue
    const cap = Math.min(...limits)
    if (bucket.length <= cap) continue
    const count = Math.ceil(bucket.length / cap)
    const groups: IepRosterRow[][] = Array.from({ length: count }, () => [])
    const strict = bucket.filter(row => smallLimit(row) === 7)
    const others = bucket.filter(row => smallLimit(row) !== 7)
    if (strict.length > 0 && strict.length <= 5) {
      groups[count - 1]!.push(...strict)
    } else {
      strict.forEach((row, index) => groups[index % count]!.push(row))
    }
    for (const row of others) {
      const candidates = groups.filter(group => group.length < cap)
      const target = strict.length > 0 && strict.length <= 5
        ? candidates.find(group => group !== groups[count - 1]) || candidates[0]!
        : candidates.reduce((a, b) => a.length <= b.length ? a : b)
      target.push(row)
    }
    groups.forEach((group, index) => {
      for (const row of group) row.finalGroup = row.accommodationGroup.replace(/^Group ([A-Z])/, `Group $1${index + 1}`)
    })
  }
  return rows
}

export function buildIepRoster(input: {
  submissions: SchedulableSubmission[]
  reviewsBySubmission: Map<string, ExamReviewInput[]>
  stages: ExamReviewStage[]
  labels: LabelInfo[]
  config: ExamSchedulingConfig
}) {
  const { config } = input
  const eligible = [...new Map(input.submissions.filter(submission => !isWithdrawnSubmission(submission)
    && (submission.labelIds || []).some(id => config.iep504LabelIds.includes(id) || id === config.mllLabelId))
    .map(submission => [submission.submissionId, submission])).values()]
  const sessions = detectSessions(eligible, input.labels, config.sessionLabelPattern).filter(session => session.count > 0)
  const rows: IepRosterRow[] = []
  let withoutDay = 0
  for (const submission of eligible) {
    const days = sessions.filter(session => submission.labelIds?.includes(session.labelId))
    if (!days.length) {
      withoutDay++
      continue
    }
    const fields = submission.mappedFields || {}
    const reviews = input.reviewsBySubmission.get(submission.submissionId) || []
    const { completion, actual, iep, plan504, mll } = resolveExamReviews(submission, reviews, input.stages)
    const assessment = assessExamMember(submission, reviews, config, input.stages)
    const hasIep = config.iep504LabelIds.some(id => submission.labelIds?.includes(id))
    const hasMll = Boolean(config.mllLabelId && submission.labelIds?.includes(config.mllLabelId))
    const accommodations = text(actual?.mappedData?.Accommodations)
    const mllAnswer = answer(mll?.mappedData?.MLLAccommodations)
    const mllSupport = mllAnswer === 'Yes'
    const language = text(mll?.mappedData?.Language)
    const completeDocuments = answer(iep?.mappedData?.CompleteIEP) || answer(plan504?.mappedData?.Complete504) || answer(completion?.mappedData?.CompleteIEP504)
    const initialType = normalized(join([fields.IEPorNPSPor504, fields.IEPor504]))
    const type = /\biep\b|npsp/.test(initialType) || iep ? 'IEP' : /504/.test(initialType) || plan504 ? '504' : hasMll ? 'MLL' : 'Unknown'
    const group = !hasIep && !accommodations && mllAnswer === 'No'
      ? 'No Accommodations'
      : accommodationGroup(accommodations, mllSupport, language, config.noAccommodationsValue)
    const accommodationsRequired = mllSupport ? 'Yes' : accommodations ? (group === 'No Accommodations' ? 'No' : 'Yes') : !hasIep && mllAnswer === 'No' ? 'No' : ''
    const notices: string[] = []
    const warnings: string[] = []
    if (completeDocuments === 'No') notices.push('Incomplete IEP/504 Submitted')
    if (assessment.completionBlocked || (hasIep && !completion && !actual)) notices.push('Completion Review Incomplete')
    if (mllSupport) notices.push(`MLL Language: ${language || 'Unknown'}`)
    if (hasIep && !actual) warnings.push('IEP/504 review incomplete')
    if (hasMll && !mllAnswer) warnings.push('MLL eligibility review missing or unanswered')
    if (mllSupport && !language) warnings.push('Reviewed MLL language missing')
    if (hasIep && mllSupport) warnings.push('Overlapping IEP/504 and language needs: review subgroup suitability')
    if (!accommodations && hasIep) warnings.push('Accommodations unknown')
    if (days.length > 1) warnings.push('Multiple test-day labels')
    if (!text(fields.FirstName) || !text(fields.LastName)) warnings.push('Confirmed student name incomplete')
    if (!text(fields.ParentPhone)) warnings.push('Parent phone missing')
    for (const day of days) rows.push({
      submissionId: submission.submissionId, submissionIdInt: submission.submissionIdInt,
      sessionLabelId: day.labelId, examDate: day.name,
      firstName: text(fields.FirstName), lastName: text(fields.LastName),
      fullName: text(fields.FullName) || join([fields.FirstName, fields.LastName]).replace('; ', ' '),
      type, completeDocuments, accommodationsRequired,
      accommodations: join([accommodations, mllSupport ? `${language || 'Unknown language'} Support` : '']),
      otherAccommodations: text(actual?.mappedData?.AccommodationsDescribe),
      parentPhone: text(fields.ParentPhone), language, mllSupport,
      accommodationGroup: group, finalGroup: group, notices: [...notices], warnings: [...warnings]
    })
  }
  return { sessions, rows: splitAccommodationGroups(rows), diagnostics: withoutDay ? [`${withoutDay} IEP/504/MLL submissions have no test-day label and are excluded.`] : [] }
}
