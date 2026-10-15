import { describe, expect, it } from 'vitest'
import { normalizeRoutingConfig, routingConfigSchema } from './routingConfig'
import { evaluateConditionGroup, type RoutingContext } from './routingEvaluator'

const context = (fields: Record<string, unknown> = {}): RoutingContext => ({
  submission: { submissionId: 's', mappedFields: fields, isMapped: true, labelIds: ['label-1'], hsptResultId: 'result' },
  reviews: [{ stageId: 'review', status: 'completed', completedAt: '2026-01-01', mappedData: { Decision: 'Yes' } }],
  gpa: { dpscd: { quartersAvailable: 4 } },
  cycleRound: 'round-1'
})

describe('routing condition groups', () => {
  it('preserves the meaning of legacy mixed all/any groups and templates', () => {
    const legacy = { all: [
      { kind: 'field', name: 'A', op: 'eq', value: 'yes' },
      { any: [
        { kind: 'field', name: 'B', op: 'eq', value: 'yes' },
        { kind: 'field', name: 'C', op: 'eq', value: 'yes' }
      ] }
    ], any: [
      { kind: 'label', op: 'hasLabel', labelId: 'label-1' },
      { kind: 'cycleRound', op: 'eq', value: 'round-2' }
    ] }
    const parsed = normalizeRoutingConfig({ requiredWhen: legacy })
    expect(parsed.requiredWhen).toMatchObject({ operator: 'and', conditions: [
      { kind: 'field', name: 'A' },
      { operator: 'or', conditions: [{ kind: 'field', name: 'B' }, { kind: 'field', name: 'C' }] },
      { operator: 'or', conditions: [{ kind: 'label' }, { kind: 'cycleRound' }] }
    ] })
    for (const fields of [{ A: 'yes', B: 'yes' }, { A: 'yes', C: 'yes' }, { A: 'no', B: 'yes' }, { A: 'yes' }]) {
      expect(evaluateConditionGroup(parsed.requiredWhen, context(fields))).toBe(evaluateConditionGroup(legacy, context(fields)))
    }
  })

  it('supports nested AND/OR and neutral empty roots', () => {
    const group = { operator: 'or', conditions: [
      { operator: 'and', conditions: [
        { kind: 'field', name: 'A', op: 'eq', value: 'yes' },
        { kind: 'field', name: 'B', op: 'eq', value: 'yes' }
      ] },
      { operator: 'and', conditions: [
        { kind: 'field', name: 'C', op: 'eq', value: 'yes' },
        { kind: 'field', name: 'D', op: 'eq', value: 'yes' }
      ] }
    ] }
    expect(evaluateConditionGroup(group, context({ A: 'yes', B: 'yes' }))).toBe(true)
    expect(evaluateConditionGroup(group, context({ C: 'yes', D: 'yes' }))).toBe(true)
    expect(evaluateConditionGroup(group, context({ A: 'yes', D: 'yes' }))).toBe(false)
    expect(evaluateConditionGroup({ operator: 'or', conditions: [] }, context())).toBe(true)
    expect(evaluateConditionGroup(normalizeRoutingConfig({ requiredWhen: { all: [], any: [] } }).requiredWhen, context())).toBe(true)
  })

  it('changes only the selected group when its shared connector is switched', () => {
    const conditions = [
      { kind: 'field', name: 'A', op: 'eq', value: 'yes' },
      { operator: 'and', conditions: [
        { kind: 'field', name: 'B', op: 'eq', value: 'yes' },
        { kind: 'field', name: 'C', op: 'eq', value: 'yes' }
      ] }
    ]
    const before = routingConfigSchema.parse({ requiredWhen: { operator: 'and', conditions } }).requiredWhen
    const after = routingConfigSchema.parse({ requiredWhen: { operator: 'or', conditions } }).requiredWhen
    expect(evaluateConditionGroup(before, context({ A: 'yes' }))).toBe(false)
    expect(evaluateConditionGroup(after, context({ A: 'yes' }))).toBe(true)
    expect(after.conditions[1]).toMatchObject({ operator: 'and' })
  })

  it('converts drafts across required, status, outcome and action condition paths', () => {
    const when = { any: [{ kind: 'hsptLinked', exists: false }, { kind: 'label', labelId: 'label-1', op: 'hasLabel' }] }
    const config = routingConfigSchema.parse({
      requiredWhen: when,
      statusRules: [{ name: 'waiting', status: 'Waiting', complete: false, when }],
      outcomeRules: [{ name: 'next', when }],
      entryActions: [{ when }],
      exitActions: [{ when }]
    })
    for (const group of [config.requiredWhen, config.statusRules[0]!.when, config.outcomeRules[0]!.when, config.entryActions[0]!.when, config.exitActions[0]!.when]) {
      expect(group).toMatchObject({ operator: 'or', conditions: [{ kind: 'hsptLinked' }, { kind: 'label' }] })
    }
  })

  it('evaluates typed values and specialized conditions', () => {
    const conditions = [
      { kind: 'field', name: 'Score', op: 'in', value: [2, 3] },
      { kind: 'reviewField', stageId: 'review', name: 'Decision', op: 'eq', value: 'Yes' },
      { kind: 'gpaStatus', op: 'in', value: ['Incomplete', 'DPSCD Partial'] },
      { kind: 'hsptLinked', exists: true },
      { kind: 'gpaRecord', source: 'dpscd', exists: true },
      { kind: 'cycleRound', op: 'eq', value: 'round-1' }
    ]
    expect(evaluateConditionGroup({ operator: 'and', conditions }, context({ Score: 2 }))).toBe(true)
    expect(evaluateConditionGroup({ operator: 'and', conditions }, context({ Score: '2' }))).toBe(false)
  })
})
