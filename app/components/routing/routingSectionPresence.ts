import type { RoutingConfig } from './copyRoutingConfig'

function hasCondition(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const group = value as Record<string, unknown>
  if (typeof group.kind === 'string') return true
  return [group.conditions, group.all, group.any].some(conditions => Array.isArray(conditions) && conditions.some(hasCondition))
}

export function routingSectionPresence(config: RoutingConfig) {
  return {
    requiredWhen: hasCondition(config.requiredWhen),
    statusRules: config.statusRules.length > 0,
    statusLabels: Object.keys(config.statusLabels || {}).length > 0,
    outcomeRules: config.outcomeRules.length > 0,
    entryActions: config.entryActions.length > 0,
    exitActions: config.exitActions.length > 0
  }
}
