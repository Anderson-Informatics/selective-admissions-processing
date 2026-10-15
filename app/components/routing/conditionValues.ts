export function newCondition(kind: string): Record<string, unknown> {
  if (kind === 'label') return { kind, op: 'hasLabel', labelId: '' }
  if (kind === 'hsptLinked') return { kind, exists: true }
  if (kind === 'gpaRecord') return { kind, source: 'any', exists: true }
  if (kind === 'mappedInitialForm') return { kind, op: 'eq', value: true }
  if (kind === 'pipelinePrerequisitesComplete') return { kind }
  if (kind === 'reviewScore' || kind === 'reviewCount' || kind === 'reviewSpread') return { kind, stageId: '', op: 'eq', value: 0 }
  if (kind === 'cycleRound' || kind === 'gpaStatus') return { kind, op: 'eq', value: '' }
  if (kind === 'reviewField') return { kind, stageId: '', name: '', op: 'eq', value: '' }
  return { kind, name: '', op: 'eq', value: '' }
}

export function conditionValueList(condition: Record<string, unknown>): string[] {
  if (Array.isArray(condition.value)) return condition.value.map(String)
  return condition.value === undefined || condition.value === '' ? [] : [String(condition.value)]
}

export function numericValueList(condition: Record<string, unknown>, values: string[]): Array<string | number> {
  const numeric = ['reviewScore', 'reviewCount', 'reviewSpread'].includes(String(condition.kind))
  const old = Array.isArray(condition.value) ? condition.value : []
  return values.map(value => value.trim()).filter(Boolean).map((value) => {
    if (numeric) return Number.isFinite(Number(value)) ? Number(value) : value
    const existing = old.find(item => typeof item === 'number' && String(item) === value)
    return existing === undefined ? value : existing
  })
}

export function changeOperator(condition: Record<string, unknown>, op: string): Record<string, unknown> {
  if (condition.op === op) return condition
  const value = condition.value
  if (op === 'in' || op === 'nin') return { ...condition, op, value: Array.isArray(value) ? value : value === undefined || value === '' ? [] : [value] }
  if (op === 'isNull' || op === 'notNull' || op === 'hasLabel' || op === 'lacksLabel') {
    const { value: _value, ...rest } = condition
    return { ...rest, op }
  }
  const scalar = Array.isArray(value) ? value[0] ?? '' : value ?? ''
  const numeric = ['gt', 'gte', 'lt', 'lte'].includes(op) || ['reviewScore', 'reviewCount', 'reviewSpread'].includes(String(condition.kind))
  return { ...condition, op, value: numeric && scalar !== '' && Number.isFinite(Number(scalar)) ? Number(scalar) : scalar }
}
