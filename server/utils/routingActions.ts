import { evaluateConditionGroup, type RoutingContext, type RoutingDecision, type RoutingStage } from './routingEvaluator'
import type { ConditionGroup } from './routingConfig'

export interface EditingActionConfig {
  templateId?: string
  internalNoteTemplate?: string
  subjectTemplate?: string
  messageTemplate?: string
  variables?: string[]
}

export interface RoutingActionDiagnostic {
  code: string
  message: string
}

export interface ResolvedRoutingActions {
  move?: { fromStageId?: string, toStageId?: string, backward: boolean, reason: string }
  labelsToAdd: string[]
  labelsToRemove: string[]
  assignUserIds: string[]
  unassignUserIds: string[]
  statusLabelIds: string[]
  statusLabelSync: boolean
  openForEditing?: EditingActionConfig
  closeForEditing?: EditingActionConfig
  diagnostics: RoutingActionDiagnostic[]
}

interface StageAction {
  when?: ConditionGroup
  addLabelIds?: string[]
  removeLabelIds?: string[]
  assignUserIds?: string[]
  unassignUserIds?: string[]
  setFields?: Record<string, unknown>
  openForEditing?: EditingActionConfig
  closeForEditing?: EditingActionConfig
}

interface OutcomeRule extends StageAction {
  name?: string
  enabled?: boolean
  moveToStageId?: string
}

function matchingActions(actions: StageAction[] | undefined, context: RoutingContext): StageAction[] {
  return (actions || []).filter(action => !action.when || evaluateConditionGroup(action.when, context))
}

export function matchedOutcomeRule(stages: RoutingStage[], context: RoutingContext): OutcomeRule | undefined {
  const current = stages.find(stage => stage.stageId === context.submission.currentStageId)
  if (!current?.routing.enabled) return undefined
  return ((current.routing.outcomeRules || []) as OutcomeRule[])
    .find(rule => rule.enabled !== false && evaluateConditionGroup(rule.when, context))
}

export function resolveRoutingActions(
  stages: RoutingStage[],
  context: RoutingContext,
  decision: RoutingDecision,
  reviewCompletion: Array<{ stageId: string, status: string }>
): ResolvedRoutingActions {
  const diagnostics: RoutingActionDiagnostic[] = []
  const labelsToAdd = new Set<string>()
  const labelsToRemove = new Set<string>()
  const assignUserIds = new Set<string>()
  const unassignUserIds = new Set<string>()
  let openForEditing: EditingActionConfig | undefined
  let closeForEditing: EditingActionConfig | undefined

  const collect = (actions: StageAction[]) => {
    for (const action of actions) {
      action.addLabelIds?.forEach(id => labelsToAdd.add(id))
      action.removeLabelIds?.forEach(id => labelsToRemove.add(id))
      action.assignUserIds?.forEach(id => assignUserIds.add(id))
      action.unassignUserIds?.forEach(id => unassignUserIds.add(id))
      if (action.setFields && Object.keys(action.setFields).length) {
        diagnostics.push({
          code: 'set_fields_deferred',
          message: 'setFields is deferred to score compilation; action skipped.'
        })
      }
      if (!openForEditing && action.openForEditing) openForEditing = action.openForEditing
      if (!closeForEditing && action.closeForEditing) closeForEditing = action.closeForEditing
    }
  }

  let move: ResolvedRoutingActions['move']
  if (decision.action === 'move' && decision.toStageId) {
    const fromStage = stages.find(stage => stage.stageId === decision.fromStageId)
    const toStage = stages.find(stage => stage.stageId === decision.toStageId)
    move = { fromStageId: decision.fromStageId, toStageId: decision.toStageId, backward: decision.backward, reason: decision.reason }
    collect(matchingActions(fromStage?.routing.exitActions as StageAction[] | undefined, context))
    const outcome = matchedOutcomeRule(stages, context)
    if (outcome?.moveToStageId === decision.toStageId) collect([outcome])
    collect(matchingActions(toStage?.routing.entryActions as StageAction[] | undefined, context))
  }

  // statusLabels sync: for every enabled stage with a status→label map, ensure the
  // label matching the submission's current ledger status is applied and the stage's
  // other mapped labels are removed.
  const statusLabelIds = new Set<string>()
  let statusLabelSync = false
  for (const stage of stages) {
    const statusLabels = stage.routing.statusLabels
    if (!stage.routing.enabled || !statusLabels) continue
    statusLabelSync = true
    const mappedLabelIds = Object.values(statusLabels).filter((id): id is string => typeof id === 'string' && Boolean(id))
    const entry = reviewCompletion.find(item => item.stageId === stage.stageId)
    const desired = entry ? statusLabels[entry.status] : undefined
    for (const labelId of mappedLabelIds) {
      if (labelId === desired) {
        labelsToAdd.add(labelId)
        statusLabelIds.add(labelId)
      } else {
        labelsToRemove.add(labelId)
      }
    }
  }
  for (const id of labelsToAdd) labelsToRemove.delete(id)

  return {
    move,
    labelsToAdd: [...labelsToAdd],
    labelsToRemove: [...labelsToRemove],
    assignUserIds: [...assignUserIds],
    unassignUserIds: [...unassignUserIds],
    statusLabelIds: [...statusLabelIds],
    statusLabelSync,
    openForEditing,
    closeForEditing,
    diagnostics
  }
}

const MERGE_TOKEN = /\{\{\s*([^{}]+?)\s*\}\}/g

function stringifyValue(value: unknown): string {
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (Array.isArray(value)) return value.map(stringifyValue).filter(Boolean).join(', ')
  if (typeof value === 'object') return ''
  return String(value)
}

function latestCompletedReview(context: RoutingContext, stageName: string) {
  const needle = stageName.trim().toLowerCase()
  return context.reviews
    .filter(review => (review.stageName || '').trim().toLowerCase() === needle)
    .filter(review => Boolean(review.completedAt) || ['complete', 'completed'].includes((review.status || '').trim().toLowerCase()))
    .sort((a, b) => new Date(b.completedAt || b.createdAt || 0).getTime() - new Date(a.completedAt || a.createdAt || 0).getTime())[0]
}

function resolveMergeToken(token: string, context: RoutingContext): unknown {
  const dotIndex = token.lastIndexOf('.')
  if (dotIndex > 0) {
    const stageName = token.slice(0, dotIndex)
    const fieldName = token.slice(dotIndex + 1)
    const review = latestCompletedReview(context, stageName)
    if (review && Object.hasOwn(review.mappedData || {}, fieldName)) {
      return review.mappedData![fieldName]
    }
    // fall back to a dotted path on submission mappedFields
    const value = token.split('.').reduce<unknown>((current, key) => (
      current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined
    ), context.submission.mappedFields)
    if (value !== undefined) return value
  }
  if (Object.hasOwn(context.submission.mappedFields, token)) {
    return context.submission.mappedFields[token]
  }
  return undefined
}

export const MERGE_FORMATS = ['list', 'numbered', 'comma'] as const
export type MergeFormat = typeof MERGE_FORMATS[number]

export interface MergeRenderOptions {
  /** `html` escapes values and renders list blocks; `text` (default) is plain text for subjects and notes. */
  mode?: 'html' | 'text'
  /** Canonical field name → known option labels for multi-select fields. */
  optionLabels?: Record<string, string[]>
}

export interface MergeRenderResult {
  text: string
  unresolved: string[]
  unknownFormats: string[]
}

const LIST_BLOCK = /<p\b[^>]*>\s*\{\{\s*([^{}]+?)\s*\}\}\s*<\/p>/gi

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function parseToken(rawToken: string): { name: string, format?: string } {
  const pipe = rawToken.indexOf('|')
  if (pipe < 0) return { name: rawToken.trim() }
  return { name: rawToken.slice(0, pipe).trim(), format: rawToken.slice(pipe + 1).trim().toLowerCase() || undefined }
}

/** Splits a stored multi-value answer into items, preferring known option labels (which may contain "; "). */
export function splitListValue(value: unknown, optionLabels: string[] = []): string[] {
  if (Array.isArray(value)) return value.map(stringifyValue).map(item => item.trim()).filter(Boolean)
  const text = stringifyValue(value)
  if (!text.trim()) return []
  const labels = [...optionLabels].sort((a, b) => b.length - a.length)
  const items: string[] = []
  let position = 0
  while (position < text.length) {
    const rest = text.slice(position)
    const label = labels.find(candidate => rest.startsWith(candidate) && (rest.length === candidate.length || rest.slice(candidate.length).startsWith(';')))
    const next = label ? label.length : (rest.indexOf(';') < 0 ? rest.length : rest.indexOf(';'))
    items.push(rest.slice(0, next).trim())
    position += next
    while (text[position] === ';' || text[position] === ' ') position += 1
  }
  return items.filter(Boolean)
}

function joinComma(items: string[]): string {
  if (items.length <= 1) return items[0] || ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

export function renderMergeFields(
  text: string,
  context: RoutingContext,
  options: MergeRenderOptions = {}
): MergeRenderResult {
  const html = options.mode === 'html'
  const unresolved = new Set<string>()
  const unknownFormats = new Set<string>()
  const escape = (value: string) => (html ? escapeHtml(value) : value)

  const resolve = (rawToken: string) => {
    const { name, format } = parseToken(rawToken)
    const value = resolveMergeToken(name, context)
    if (value === undefined) unresolved.add(name)
    if (format && !(MERGE_FORMATS as readonly string[]).includes(format)) unknownFormats.add(`${name} | ${format}`)
    const fieldName = name.slice(name.lastIndexOf('.') + 1)
    const items = () => splitListValue(value, options.optionLabels?.[fieldName] || options.optionLabels?.[name])
    return { value, format: format as MergeFormat | undefined, items }
  }

  // List blocks are swapped for placeholders so rendered values are never re-scanned for tokens.
  const blocks: string[] = []
  let output = text
  if (html) {
    output = output.replace(LIST_BLOCK, (match, rawToken: string) => {
      const token = resolve(rawToken)
      if (token.format !== 'list' && token.format !== 'numbered') return match
      const items = token.value === undefined ? [] : token.items()
      const tag = token.format === 'numbered' ? 'ol' : 'ul'
      blocks.push(items.length ? `<${tag}>${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</${tag}>` : '')
      return `\uE000${blocks.length - 1}\uE000`
    })
  }

  output = output.replace(MERGE_TOKEN, (_, rawToken: string) => {
    const token = resolve(rawToken)
    if (token.value === undefined) return ''
    if (token.format && (MERGE_FORMATS as readonly string[]).includes(token.format)) return escape(joinComma(token.items()))
    return escape(stringifyValue(token.value))
  })
  output = output.replace(/\uE000(\d+)\uE000/g, (_, index: string) => blocks[Number(index)] ?? '')
  return { text: output, unresolved: [...unresolved], unknownFormats: [...unknownFormats] }
}
