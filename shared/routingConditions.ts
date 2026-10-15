export function normalizeConditionGroup(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const group = value as Record<string, unknown>
  if (group.operator === 'and' || group.operator === 'or') {
    return { ...group, conditions: Array.isArray(group.conditions) ? group.conditions.map(normalizeConditionGroup) : group.conditions }
  }
  if (!('all' in group) && !('any' in group)) return value
  const all = Array.isArray(group.all) ? group.all.map(normalizeConditionGroup) : []
  const any = Array.isArray(group.any) ? group.any.map(normalizeConditionGroup) : []
  if (!any.length) return { operator: 'and', conditions: all }
  if (!all.length) return { operator: 'or', conditions: any }
  return { operator: 'and', conditions: [...all, { operator: 'or', conditions: any }] }
}
