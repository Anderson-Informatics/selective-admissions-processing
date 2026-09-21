import type { ConditionGroup, RoutingConfig } from './routingConfig'

export type ReviewStageRole = 'initial' | 'work' | 'hold' | 'final'

export interface RoutingStage {
  stageId: string
  name: string
  order: number
  role: ReviewStageRole
  routing: RoutingConfig
}

export interface RoutingReview {
  stageId: string
  status?: string
  score?: number
  completedAt?: Date | string
  createdAt?: Date | string
  mappedData?: Record<string, unknown>
}

export interface RoutingGpaRecord {
  dpscd?: {
    quartersAvailable?: number
    cumulativeGpa?: number
  }
  optIn?: {
    termsEnrolled?: number
    enrolledMinTerms?: string
    enrolledMinTermsFlag?: boolean
    cumulativeGpa?: number
  }
}

export interface RoutingSubmission {
  submissionId: string
  mappedFields: Record<string, unknown>
  isMapped: boolean
  labelIds?: string[]
  currentStageId?: string
  hsptResultId?: string
  status?: string
}

export interface RoutingContext {
  submission: RoutingSubmission
  reviews: RoutingReview[]
  gpa?: RoutingGpaRecord
  gpaStatus?: string
  cycleRound?: string
  prerequisitesComplete?: boolean
}

export interface ReviewCompletionEntry {
  stageId: string
  name: string
  order: number
  role: ReviewStageRole
  required: boolean
  status: string
  complete: boolean
}

export interface RoutingDiagnostic {
  code: 'overlapping_required_stages' | 'no_required_stage' | 'invalid_target_stage'
  message: string
  stageIds?: string[]
}

export interface ReviewCompletionResult {
  reviewCompletion: ReviewCompletionEntry[]
  diagnostics: RoutingDiagnostic[]
}

export interface RoutingDecision {
  action: 'stay' | 'move'
  reason: 'already_current' | 'final_stage' | 'outcome' | 'next_required' | 'no_required_stage' | 'invalid_target'
  fromStageId?: string
  toStageId?: string
  backward: boolean
  diagnostics: RoutingDiagnostic[]
}

type ConditionValue = Record<string, unknown>
type ConditionGroupValue = ConditionGroup & { all?: unknown[], any?: unknown[] }

type StatusRule = {
  name: string
  when?: ConditionGroup
  status: string
  complete: boolean
}

type OutcomeRule = {
  name: string
  enabled?: boolean
  when: ConditionGroup
  moveToStageId?: string
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function getPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => asRecord(current)[key], value)
}

function isPresent(value: unknown): boolean {
  return value !== null && value !== undefined && value !== ''
}

function normalizeComparable(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value
}

function compareValue(actual: unknown, op: string | undefined, expected: unknown): boolean {
  if (op === 'isNull') return !isPresent(actual)
  if (op === 'notNull') return isPresent(actual)
  if (op === 'in' || op === 'nin') {
    const values = Array.isArray(expected) ? expected.map(normalizeComparable) : []
    const included = values.includes(normalizeComparable(actual))
    return op === 'in' ? included : !included
  }
  if (op === 'hasLabel' || op === 'lacksLabel') return op === 'hasLabel' ? Boolean(actual) : !actual

  const left = normalizeComparable(actual)
  const right = normalizeComparable(expected)
  switch (op) {
    case 'eq': return left === right
    case 'ne': return left !== right
    case 'gt': return typeof left === 'number' && typeof right === 'number' && left > right
    case 'gte': return typeof left === 'number' && typeof right === 'number' && left >= right
    case 'lt': return typeof left === 'number' && typeof right === 'number' && left < right
    case 'lte': return typeof left === 'number' && typeof right === 'number' && left <= right
    default: return Boolean(left)
  }
}

function reviewTimestamp(review: RoutingReview, scope: 'completedAt' | 'createdAt'): number {
  const value = review[scope]
  return value ? new Date(value).getTime() : 0
}

function isCompletedReview(review: RoutingReview): boolean {
  const status = review.status?.trim().toLowerCase()
  return Boolean(review.completedAt) || status === 'complete' || status === 'completed'
}

export function resolveReviews(reviews: RoutingReview[], stageId: string, scope = 'latestCompleted'): RoutingReview[] {
  const matching = reviews.filter(review => review.stageId === stageId)
  if (scope === 'any' || scope === 'all') return matching
  const candidates = scope === 'latestSubmitted'
    ? matching
    : matching.filter(isCompletedReview)
  const latest = [...candidates].sort((a, b) => reviewTimestamp(b, scope === 'latestSubmitted' ? 'createdAt' : 'completedAt') - reviewTimestamp(a, scope === 'latestSubmitted' ? 'createdAt' : 'completedAt'))[0]
  return latest ? [latest] : []
}

function getStageReviews(context: RoutingContext, condition: ConditionValue): RoutingReview[] {
  const stageIds = Array.isArray(condition.stageIds) ? condition.stageIds.filter((id): id is string => typeof id === 'string') : []
  const stageId = typeof condition.stageId === 'string' ? condition.stageId : undefined
  const ids = stageIds.length ? stageIds : stageId ? [stageId] : []
  return ids.flatMap(id => resolveReviews(context.reviews, id, typeof condition.scope === 'string' ? condition.scope : 'latestCompleted'))
}

export function deriveGpaStatus(context: RoutingContext): string {
  if (context.gpaStatus) return context.gpaStatus
  const fields = context.submission.mappedFields
  const cumulative = fields.CumulativeGPA ?? fields.cumulativeGPA ?? context.gpa?.dpscd?.cumulativeGpa ?? context.gpa?.optIn?.cumulativeGpa
  const quarters = context.gpa?.dpscd?.quartersAvailable
  const terms = context.gpa?.optIn?.termsEnrolled
  const enrolled = context.gpa?.optIn?.enrolledMinTermsFlag || context.gpa?.optIn?.enrolledMinTerms?.toLowerCase() === 'yes'
  if (isPresent(cumulative) || (typeof quarters === 'number' && quarters >= 6) || (enrolled && typeof terms === 'number' && terms >= 4)) return 'Complete'
  if (isPresent(fields.PartialGPA) || fields.Semesters === 'DPSCD Student Without Upload' || (typeof quarters === 'number' && quarters > 0)) return quarters != null && quarters < 6 ? 'DPSCD Partial' : 'Partial'
  return 'Incomplete'
}

export function evaluateCondition(condition: unknown, context: RoutingContext): boolean {
  const value = asRecord(condition)
  const kind = value.kind
  const op = typeof value.op === 'string' ? value.op : undefined
  const expected = value.value

  switch (kind) {
    case 'field':
      return compareValue(getPath(context.submission.mappedFields, String(value.name || value.field || '')), op, expected)
    case 'label': {
      const hasLabel = typeof value.labelId === 'string' && (context.submission.labelIds || []).includes(value.labelId)
      return op === 'lacksLabel' ? !hasLabel : hasLabel
    }
    case 'reviewField': {
      const reviews = getStageReviews(context, value)
      const actuals = reviews.map(review => getPath(review.mappedData || {}, String(value.name || value.field || '')))
      return value.scope === 'all' ? actuals.length > 0 && actuals.every(actual => compareValue(actual, op, expected)) : actuals.some(actual => compareValue(actual, op, expected))
    }
    case 'reviewScore': {
      const scores = getStageReviews(context, value).map(review => review.score)
      return value.scope === 'all' ? scores.length > 0 && scores.every(score => compareValue(score, op, expected)) : scores.some(score => compareValue(score, op, expected))
    }
    case 'reviewCount': {
      const stageIds = Array.isArray(value.stageIds) ? value.stageIds : typeof value.stageId === 'string' ? [value.stageId] : []
      const statusIn = Array.isArray(value.statusIn) ? value.statusIn.filter((status): status is string => typeof status === 'string') : undefined
      const count = context.reviews.filter(review => stageIds.includes(review.stageId) && (!statusIn || statusIn.includes(review.status || ''))).length
      return compareValue(count, op, expected)
    }
    case 'reviewSpread': {
      const scores = getStageReviews(context, { ...value, scope: 'all' }).map(review => review.score).filter((score): score is number => typeof score === 'number')
      const spread = scores.length ? Math.max(...scores) - Math.min(...scores) : undefined
      return compareValue(spread, op, expected)
    }
    case 'hsptLinked':
      return compareValue(isPresent(context.submission.hsptResultId), typeof value.exists === 'boolean' ? (value.exists ? 'eq' : 'ne') : op, true)
    case 'gpaRecord': {
      const source = value.source === 'dpscd' ? context.gpa?.dpscd : value.source === 'optIn' ? context.gpa?.optIn : context.gpa
      const exists = isPresent(source)
      if (typeof value.exists === 'boolean') return exists === value.exists
      if (value.source === 'dpscd' && value.quartersAvailable !== undefined) return compareValue(context.gpa?.dpscd?.quartersAvailable, op, value.quartersAvailable)
      if (value.source === 'optIn' && value.termsEnrolled !== undefined) return compareValue(context.gpa?.optIn?.termsEnrolled, op, value.termsEnrolled)
      return exists
    }
    case 'gpaStatus': return compareValue(deriveGpaStatus(context), op, expected)
    case 'cycleRound': return compareValue(context.cycleRound, op, expected)
    case 'mappedInitialForm': return compareValue(context.submission.isMapped, op || 'eq', expected ?? true)
    case 'pipelinePrerequisitesComplete': return context.prerequisitesComplete === true
    default: return false
  }
}

export function evaluateConditionGroup(group: unknown, context: RoutingContext): boolean {
  if (!group) return true
  const value = group as ConditionGroupValue
  const all: unknown[] = Array.isArray(value.all) ? value.all : []
  const any: unknown[] = Array.isArray(value.any) ? value.any : []
  const allPass = all.every((item: unknown) => 'kind' in asRecord(item) ? evaluateCondition(item, context) : evaluateConditionGroup(item, context))
  const anyPass = any.length === 0 || any.some((item: unknown) => 'kind' in asRecord(item) ? evaluateCondition(item, context) : evaluateConditionGroup(item, context))
  return allPass && anyPass
}

function getStatus(stage: RoutingStage, context: RoutingContext): { status: string, complete: boolean } {
  if (stage.role === 'initial' && context.submission.isMapped) return { status: 'Mapped', complete: true }
  const rules = (stage.routing.statusRules || []) as StatusRule[]
  for (const rule of rules) {
    if (!rule.when || evaluateConditionGroup(rule.when, context)) return { status: rule.status, complete: stage.role === 'final' ? false : rule.complete }
  }
  if (stage.role === 'final') return { status: 'Final', complete: false }
  return { status: 'Incomplete', complete: false }
}

export function computeReviewCompletion(stages: RoutingStage[], context: RoutingContext): ReviewCompletionResult {
  const reviewCompletion = [...stages].sort((a, b) => a.order - b.order).map((stage) => {
    const status = getStatus(stage, context)
    let required = false
    if (stage.role !== 'final') {
      required = stage.role === 'initial'
        ? true
        : stage.routing.requiredWhen
          ? evaluateConditionGroup(stage.routing.requiredWhen, context)
          : stage.routing.enabled
    }
    return { stageId: stage.stageId, name: stage.name, order: stage.order, role: stage.role, required, ...status }
  })

  const requiredIncomplete = reviewCompletion.filter(entry => entry.required && !entry.complete)
  const diagnostics: RoutingDiagnostic[] = []
  if (requiredIncomplete.length > 1) {
    diagnostics.push({ code: 'overlapping_required_stages', message: 'Multiple required incomplete stages match; order determines the next stage.', stageIds: requiredIncomplete.map(entry => entry.stageId) })
  }
  return { reviewCompletion, diagnostics }
}

export function routeSubmission(stages: RoutingStage[], context: RoutingContext): RoutingDecision {
  const current = stages.find(stage => stage.stageId === context.submission.currentStageId)
  const completion = computeReviewCompletion(stages, context)
  if (current?.role === 'final') return { action: 'stay', reason: 'final_stage', fromStageId: current.stageId, backward: false, diagnostics: completion.diagnostics }

  if (current?.routing.enabled) {
    const outcome = (current.routing.outcomeRules || []) as OutcomeRule[]
    const matched = outcome.find(rule => rule.enabled !== false && evaluateConditionGroup(rule.when, context))
    if (matched?.moveToStageId) {
      const target = stages.find(stage => stage.stageId === matched.moveToStageId)
      if (!target) return { action: 'stay', reason: 'invalid_target', fromStageId: current.stageId, backward: false, diagnostics: [...completion.diagnostics, { code: 'invalid_target_stage', message: `Outcome rule targets missing stage ${matched.moveToStageId}.`, stageIds: [matched.moveToStageId] }] }
      return { action: target.stageId === current.stageId ? 'stay' : 'move', reason: 'outcome', fromStageId: current.stageId, toStageId: target.stageId, backward: target.order < current.order, diagnostics: completion.diagnostics }
    }
  }

  const targetEntry = completion.reviewCompletion.find((entry) => {
    const targetStage = stages.find(stage => stage.stageId === entry.stageId)
    return entry.required && !entry.complete && targetStage?.routing.enabled
  })
  if (!targetEntry) return { action: 'stay', reason: 'no_required_stage', fromStageId: current?.stageId, backward: false, diagnostics: completion.diagnostics }
  if (targetEntry.stageId === current?.stageId) return { action: 'stay', reason: 'already_current', fromStageId: current.stageId, backward: false, diagnostics: completion.diagnostics }
  return { action: 'move', reason: 'next_required', fromStageId: current?.stageId, toStageId: targetEntry.stageId, backward: Boolean(current && targetEntry.order < current.order), diagnostics: completion.diagnostics }
}
