import { describe, expect, it } from 'vitest'
import { copyRoutingConfig, unmappedCopiedReviewFields, type RoutingConfig } from './copyRoutingConfig'

const source: RoutingConfig = {
  enabled: true,
  requiredWhen: { operator: 'and', conditions: [{ kind: 'reviewField', stageId: 'source', field: 'Decision', op: 'eq', value: 'Yes' }] },
  statusRules: [{ name: 'complete', status: 'Complete', complete: true, when: { operator: 'and', conditions: [
    { kind: 'reviewCount', stageIds: ['source', 'other'], op: 'gte', value: 2 },
    { operator: 'or', conditions: [{ kind: 'reviewField', stageId: 'source', name: 'Score', op: 'gte', value: 3 }] }
  ] } }],
  allowedStatuses: ['Complete'],
  statusLabels: { Complete: 'label-1' },
  outcomeRules: [{ name: 'outcome', when: { operator: 'and', conditions: [] }, moveToStageId: 'source' }],
  entryActions: [{ when: { operator: 'and', conditions: [{ kind: 'reviewScore', stageId: 'other', op: 'gte', value: 3 }] } }],
  exitActions: []
}
const target: RoutingConfig = {
  enabled: false,
  requiredWhen: { operator: 'and', conditions: [{ kind: 'field', name: 'DPSCD', op: 'eq', value: 'Yes' }] },
  statusRules: [{ name: 'default', status: 'Waiting', complete: false }],
  statusLabels: { Waiting: 'label-2' },
  outcomeRules: [],
  entryActions: [],
  exitActions: []
}

describe('copy routing configuration', () => {
  it('copies the whole draft without enabling routing or aliasing the source', () => {
    const copied = copyRoutingConfig(source, target, 'source', 'destination', 'all')
    expect(copied.enabled).toBe(false)
    expect(copied.requiredWhen).toMatchObject({ conditions: [{ stageId: 'destination', field: 'Decision' }] })
    expect(copied.statusRules[0]).toMatchObject({ when: { conditions: [
      { stageIds: ['destination', 'other'] },
      { conditions: [{ stageId: 'destination' }] }
    ] } })
    expect(copied.outcomeRules[0]).toMatchObject({ moveToStageId: 'source' })
    expect(copied.entryActions[0]).toMatchObject({ when: { conditions: [{ stageId: 'other' }] } })
    const copiedRule = copied.statusRules[0] as { status: string }
    copiedRule.status = 'Changed'
    expect(source.statusRules[0]).toMatchObject({ status: 'Complete' })
  })

  it('copies only a chosen section and its related allowed statuses', () => {
    const copied = copyRoutingConfig(source, target, 'source', 'destination', 'statusRules')
    expect(copied.statusRules[0]).toMatchObject({ when: { conditions: [
      { stageIds: ['destination', 'other'] },
      { conditions: [{ stageId: 'destination' }] }
    ] } })
    expect(copied.allowedStatuses).toEqual(['Complete'])
    expect(copied.requiredWhen).toBe(target.requiredWhen)
    expect(copied.statusLabels).toBe(target.statusLabels)
    expect(copied.enabled).toBe(false)
    expect(copyRoutingConfig(source, target, 'source', 'destination', 'statusLabels').statusRules).toBe(target.statusRules)
    const withoutLabels = copyRoutingConfig({ ...source, statusLabels: undefined }, target, 'source', 'destination', 'statusLabels')
    expect(withoutLabels.statusLabels).toBeUndefined()
  })

  it('reports review fields not mapped for the destination form', () => {
    const copied = copyRoutingConfig(source, target, 'source', 'destination', 'all')
    expect(unmappedCopiedReviewFields(copied, 'destination', ['Decision'])).toEqual(['Score'])
    expect(unmappedCopiedReviewFields(copied, 'destination', ['Decision', 'Score'])).toEqual([])
    expect(unmappedCopiedReviewFields(copied, 'destination', [], 'requiredWhen')).toEqual(['Decision'])
  })
})
