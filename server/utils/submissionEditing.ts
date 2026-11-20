export type EditingState = 'open' | 'closed' | 'unknown'

export function editingState(status: unknown): EditingState {
  if (status === 'editable') return 'open'
  if (status === 'complete') return 'closed'
  return 'unknown'
}

export function editingDate(value: unknown): Date | undefined {
  if (typeof value !== 'string' && !(value instanceof Date)) return undefined
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date : undefined
}

export function literalSearch(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
