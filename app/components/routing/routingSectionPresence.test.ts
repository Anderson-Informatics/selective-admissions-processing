import { describe, expect, it } from 'vitest'
import { routingSectionPresence } from './routingSectionPresence'
import type { RoutingConfig } from './copyRoutingConfig'

const emptyConfig: RoutingConfig = {
  enabled: false,
  statusRules: [],
  outcomeRules: [],
  entryActions: [],
  exitActions: []
}

describe('routing section presence', () => {
  it('marks sections without entries as not configured', () => {
    expect(routingSectionPresence(emptyConfig)).toEqual({
      requiredWhen: false,
      statusRules: false,
      statusLabels: false,
      outcomeRules: false,
      entryActions: false,
      exitActions: false
    })
    expect(routingSectionPresence({
      ...emptyConfig,
      requiredWhen: { operator: 'and', conditions: [{ operator: 'or', conditions: [] }] },
      statusLabels: {}
    }).requiredWhen).toBe(false)
  })

  it('finds nested and legacy required conditions', () => {
    const condition = { kind: 'field', name: 'Grade', op: 'eq', value: '9' }
    for (const requiredWhen of [
      { operator: 'and', conditions: [{ operator: 'or', conditions: [condition] }] },
      { all: [{ any: [condition] }] }
    ]) {
      expect(routingSectionPresence({ ...emptyConfig, requiredWhen }).requiredWhen).toBe(true)
    }
  })

  it('shows presence as soon as a rule, label, or action is added', () => {
    expect(routingSectionPresence({
      ...emptyConfig,
      statusRules: [{ name: 'New status rule' }],
      statusLabels: { 'New status': '' },
      outcomeRules: [{ name: 'New outcome rule' }],
      entryActions: [{ addLabelIds: [] }],
      exitActions: [{ addLabelIds: [] }]
    })).toEqual({
      requiredWhen: false,
      statusRules: true,
      statusLabels: true,
      outcomeRules: true,
      entryActions: true,
      exitActions: true
    })
  })
})
