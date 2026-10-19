export interface RoutingConfig {
  enabled: boolean
  requiredWhen?: Record<string, unknown>
  allowedStatuses?: string[]
  statusRules: unknown[]
  statusLabels?: Record<string, string>
  outcomeRules: unknown[]
  entryActions: unknown[]
  exitActions: unknown[]
}

export type CopyScope = 'all' | 'requiredWhen' | 'statusRules' | 'statusLabels' | 'outcomeRules' | 'entryActions' | 'exitActions'

const reviewKinds = new Set(['reviewField', 'reviewScore', 'reviewCount', 'reviewSpread'])

function visit(value: unknown, callback: (condition: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    value.forEach(item => visit(item, callback))
    return
  }
  if (!value || typeof value !== 'object') return
  const record = value as Record<string, unknown>
  if (reviewKinds.has(String(record.kind))) callback(record)
  Object.values(record).forEach(item => visit(item, callback))
}

function clone<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T
}

export function copyRoutingConfig(source: RoutingConfig, target: RoutingConfig, sourceStageId: string, targetStageId: string, scope: CopyScope): RoutingConfig {
  const copied = scope === 'all' ? clone(source) : clone(source[scope])
  visit(copied, (condition) => {
    if (condition.stageId === sourceStageId) condition.stageId = targetStageId
    if (Array.isArray(condition.stageIds)) condition.stageIds = condition.stageIds.map(id => id === sourceStageId ? targetStageId : id)
  })
  if (scope === 'all') return { ...(copied as RoutingConfig), enabled: target.enabled }
  if (scope === 'statusRules') return { ...target, statusRules: copied as unknown[], allowedStatuses: clone(source.allowedStatuses) }
  return { ...target, [scope]: copied }
}

export function unmappedCopiedReviewFields(config: RoutingConfig, targetStageId: string, mappedFields: string[], scope: CopyScope = 'all'): string[] {
  const missing = new Set<string>()
  visit(scope === 'all' ? config : config[scope], (condition) => {
    if (condition.kind !== 'reviewField') return
    const ids = Array.isArray(condition.stageIds) && condition.stageIds.length ? condition.stageIds : [condition.stageId]
    const name = condition.name || condition.field
    if (ids.includes(targetStageId) && typeof name === 'string' && !mappedFields.includes(name)) missing.add(name)
  })
  return [...missing].sort()
}
