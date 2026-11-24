import { decisionValueKey, type DecisionConfig } from './decisionConfig'
import { isWithdrawnSubmission } from './submissionStatus'

type Outcome = 'accept' | 'decline' | 'defer' | 'waitlist' | 'pending' | 'unresolved'
interface School { id: string, name: string, aliases: string[], active: boolean }
interface DecisionReview {
  applicationId: string
  stageId: string
  entryId: string
  reviewerId?: string
  status?: string
  completedAt?: string | Date
  createdAt?: string | Date
  score?: number
  mappedData?: Record<string, unknown>
}
export interface DecisionEvidence {
  entryId: string
  reviewerId?: string
  stageId: string
  value: unknown
  outcome: Outcome
  completedAt?: string | Date
  createdAt?: string | Date
  authoritative: boolean
}
export interface SchoolDecision {
  schoolId: string
  schoolName: string
  rank: number | null
  outcome: Outcome
  primaryUserId?: string
  evidence: DecisionEvidence[]
  controllingEntryIds: string[]
}
export interface DecisionResult {
  schools: SchoolDecision[]
  unattributedEvidence: DecisionEvidence[]
  choices: Array<{ rank: number, field: string, value: string, schoolId: string | null }>
  proposed: { schoolId: string, schoolName: string, rank: number } | null
  candidate: { schoolId: string, schoolName: string, rank: number } | null
  waitlists: Array<{ schoolId: string, schoolName: string, rank: number | null, aboveProposal: boolean }>
  diagnostics: string[]
  needsAttention: boolean
}
const key = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase()
const completed = (review: DecisionReview) => Boolean(review.completedAt) || /^(complete|completed)$/i.test(review.status?.trim() || '')
const timestamp = (review: DecisionReview) => {
  const value = new Date(review.completedAt || review.createdAt || '').getTime()
  return Number.isFinite(value) ? value : 0
}

export function resolveSchoolDecisions(input: {
  applicationId: string
  config: DecisionConfig
  schools: School[]
  representatives: Array<{ userId: string, schoolIds: string[], active: boolean }>
  authorities: Array<{ schoolId: string, userId: string }>
  mappedFields: Record<string, unknown>
  reviews: DecisionReview[]
  status?: string
}): DecisionResult {
  const result: DecisionResult = { schools: [], unattributedEvidence: [], choices: [], proposed: null, candidate: null, waitlists: [], diagnostics: [], needsAttention: false }
  if (isWithdrawnSubmission({ status: input.status })) return result
  const ranks = new Map<string, number>()
  const unknownRanks: number[] = []
  for (const [index, field] of input.config.preferenceFields.entries()) {
    const raw = input.mappedFields[field]
    const value = typeof raw === 'string' ? raw.trim() : ''
    const matches = value ? input.schools.filter(school => [school.name, ...school.aliases].some(alias => key(alias) === key(value))) : []
    const school = matches.length === 1 ? matches[0] : undefined
    result.choices.push({ rank: index + 1, field, value: raw == null ? '' : String(raw), schoolId: school?.id || null })
    if ((typeof raw === 'string' ? Boolean(value) : raw != null) && (!school || !school.active || !input.config.schoolIds.includes(school.id))) {
      unknownRanks.push(index + 1)
      result.diagnostics.push(`Unresolved school choice ${index + 1}: ${String(raw)}`)
    }
    if (school) {
      if (ranks.has(school.id)) result.diagnostics.push(`Duplicate school choice: ${school.name}`)
      else ranks.set(school.id, index + 1)
    }
  }
  const sources = new Map(input.config.sources.map(source => [source.stageId, source]))
  const reviews = input.reviews.filter(review => review.applicationId === input.applicationId && sources.has(review.stageId) && completed(review))
  const evidenceFor = (review: DecisionReview, authoritative = false): DecisionEvidence => {
    const source = sources.get(review.stageId)!
    const value = source.kind === 'score' ? review.score : review.mappedData?.[source.field!]
    const outcome: Outcome = (['accept', 'decline', 'defer', 'waitlist'] as const).find(outcome => source[outcome].some(item => decisionValueKey(item) === decisionValueKey(value))) || 'unresolved'
    return { entryId: review.entryId, reviewerId: review.reviewerId, stageId: review.stageId, value: value ?? null, outcome, completedAt: review.completedAt, createdAt: review.createdAt, authoritative }
  }
  const attributedUsers = new Set([
    ...input.representatives.filter(rep => rep.schoolIds.some(id => input.config.schoolIds.includes(id))).map(rep => rep.userId),
    ...input.authorities.filter(authority => input.config.schoolIds.includes(authority.schoolId)).map(authority => authority.userId)
  ])
  result.unattributedEvidence = reviews.filter(review => !review.reviewerId || !attributedUsers.has(review.reviewerId)).map(review => evidenceFor(review))
  if (reviews.some(review => !review.reviewerId)) result.diagnostics.push('Some completed decision reviews have no reviewer ID')
  for (const schoolId of input.config.schoolIds) {
    const school = input.schools.find(school => school.id === schoolId)
    const authority = input.authorities.find(authority => authority.schoolId === schoolId)
    const valid = school?.active && authority && input.representatives.some(rep => rep.active && rep.userId === authority.userId && rep.schoolIds.includes(schoolId))
    const associated = input.representatives.filter(rep => rep.schoolIds.includes(schoolId)).map(rep => rep.userId)
    const schoolReviews = reviews.filter(review => review.reviewerId && (associated.includes(review.reviewerId) || review.reviewerId === authority?.userId))
    const authoritative = valid ? schoolReviews.filter(review => review.reviewerId === authority.userId) : []
    const latestTime = Math.max(0, ...authoritative.map(timestamp))
    const latest = authoritative.filter(review => timestamp(review) === latestTime)
    const evidence = schoolReviews.map(review => evidenceFor(review, Boolean(valid && review.reviewerId === authority.userId)))
    const latestIds = latest.map(review => review.entryId)
    const outcomes = new Set(evidence.filter(item => latestIds.includes(item.entryId)).map(item => item.outcome))
    const ambiguousSchool = authority && input.authorities.filter(item => item.userId === authority.userId && input.config.schoolIds.includes(item.schoolId)).length > 1
    const outcome: Outcome = !latest.length ? 'pending' : ambiguousSchool || !latestTime || outcomes.size !== 1 ? 'unresolved' : [...outcomes][0]!
    if (ambiguousSchool) result.diagnostics.push(`Cannot attribute decisions for ${school?.name || schoolId}: primary reviewer is authoritative for multiple participating schools`)
    if (!valid) result.diagnostics.push(`Missing or inactive primary authority for ${school?.name || schoolId}`)
    if (outcome === 'unresolved') result.diagnostics.push(`Unresolved latest authoritative decision for ${school?.name || schoolId}`)
    if (latest.some(review => !review.completedAt)) result.diagnostics.push(`Completion timestamp missing for ${school?.name || schoolId}; using creation time`)
    result.schools.push({ schoolId, schoolName: school?.name || schoolId, rank: ranks.get(schoolId) ?? null, outcome, primaryUserId: authority?.userId, evidence, controllingEntryIds: latestIds })
  }
  if (reviews.some(review => review.reviewerId && !input.representatives.some(rep => rep.schoolIds.some(id => input.config.schoolIds.includes(id)) && rep.userId === review.reviewerId))) result.diagnostics.push('Completed decisions from unaffiliated reviewers were ignored')
  const accepted = result.schools.filter(school => school.outcome === 'accept' && school.rank != null).sort((a, b) => a.rank! - b.rank!)
  const first = accepted[0]
  result.candidate = first ? { schoolId: first.schoolId, schoolName: first.schoolName, rank: first.rank! } : null
  const blocked = first && (unknownRanks.some(rank => rank < first.rank!) || result.schools.some(school => school.outcome === 'unresolved' && school.rank != null && school.rank < first.rank!))
  result.proposed = blocked ? null : result.candidate
  if (first && result.schools.some(school => school.outcome === 'pending' && school.rank != null && school.rank < first.rank!)) result.diagnostics.push('Higher-ranked school decisions are pending; proposal may change')
  result.waitlists = result.schools.filter(school => school.outcome === 'waitlist').map(school => ({ schoolId: school.schoolId, schoolName: school.schoolName, rank: school.rank, aboveProposal: Boolean(result.proposed && school.rank != null && school.rank < result.proposed.rank) }))
  result.needsAttention = result.diagnostics.length > 0
  return result
}
