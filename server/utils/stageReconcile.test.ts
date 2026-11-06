import { describe, expect, it } from 'vitest'
import { diffStages } from './stageReconcile'
import { rewriteReferencedStageIds } from './routingConfig'
import type { SubmittableReviewStage } from './submittable'

const remote = (id: string, name: string, order: number, formId?: string): SubmittableReviewStage => ({
  reviewStageId: id,
  stageName: name,
  type: 'custom_review',
  formId,
  stageOrder: order
})

const local = (id: string, name: string, order: number, formId?: string) => ({
  stageId: id,
  name,
  type: 'custom_review',
  formId,
  order
})

describe('diffStages', () => {
  it('does nothing when stage ids are unchanged', () => {
    const result = diffStages(
      [local('a', 'Essay', 1), local('b', 'Hold', 2)],
      [remote('a', 'Essay', 1), remote('b', 'Hold', 2)]
    )
    expect(result).toMatchObject({ remapped: [], ambiguous: [], orphanStageIds: [], newRemoteStages: [] })
  })

  it('remaps a renamed stage by matching order', () => {
    const result = diffStages(
      [local('a', 'Essay', 1), local('old-hold', 'GPA Pending', 2)],
      [remote('a', 'Essay', 1), remote('new-hold', 'GPA Hold', 2)]
    )
    expect(result.remapped).toEqual([{ fromStageId: 'old-hold', toStageId: 'new-hold', matchedBy: 'order', name: 'GPA Hold' }])
    expect(result.orphanStageIds).toEqual([])
  })

  it('remaps a reordered stage by unique name', () => {
    const result = diffStages(
      [local('a', 'Essay', 1), local('old-hold', 'GPA Pending', 2)],
      [remote('a', 'Essay', 1), remote('x', 'Other', 5), remote('new-hold', 'GPA Pending', 3)]
    )
    expect(result.remapped).toEqual([
      { fromStageId: 'old-hold', toStageId: 'new-hold', matchedBy: 'name', name: 'GPA Pending' }
    ])
    expect(result.newRemoteStages).toEqual([{ stageId: 'x', name: 'Other' }])
  })

  it('reports ambiguous matches when rename and reorder coincide', () => {
    const result = diffStages(
      [local('old-hold', 'GPA Pending', 2)],
      [remote('x', 'Renamed A', 3), remote('y', 'Renamed B', 4)]
    )
    expect(result.remapped).toEqual([])
    expect(result.orphanStageIds).toEqual(['old-hold'])
    expect(result.newRemoteStages).toHaveLength(2)
  })

  it('reports ambiguity when multiple candidates share the order', () => {
    const result = diffStages(
      [local('a', 'Essay', 1), local('old-1', 'Hold A', 2), local('old-2', 'Hold B', 2)],
      [remote('a', 'Essay', 1), remote('x', 'New A', 2), remote('y', 'New B', 2)]
    )
    expect(result.remapped).toEqual([])
    expect(result.ambiguous).toHaveLength(2)
  })

  it('falls back to formId when order and name do not match', () => {
    const result = diffStages(
      [local('old-hold', 'GPA Pending', 2, 'form-9')],
      [remote('new-hold', 'GPA Hold', 5, 'form-9')]
    )
    expect(result.remapped).toEqual([{ fromStageId: 'old-hold', toStageId: 'new-hold', matchedBy: 'formId', name: 'GPA Hold' }])
  })
})

describe('rewriteReferencedStageIds', () => {
  const remap = new Map([['old-stage', 'new-stage']])

  it('rewrites stageId, stageIds, and moveToStageId', () => {
    const config = {
      enabled: true,
      requiredWhen: { operator: 'and', conditions: [{ kind: 'reviewCount', stageId: 'old-stage' }] },
      statusRules: [{ name: 'x', when: { operator: 'or', conditions: [{ kind: 'reviewField', stageIds: ['old-stage', 'keep'] }] }, status: 'Done', complete: true }],
      outcomeRules: [{ name: 'move', when: { operator: 'and', conditions: [] }, moveToStageId: 'old-stage' }]
    }
    const rewritten = rewriteReferencedStageIds(config, remap)
    expect(JSON.stringify(rewritten)).not.toContain('old-stage')
    expect(JSON.stringify(rewritten)).toContain('new-stage')
    expect(JSON.stringify(rewritten)).toContain('"keep"')
  })

  it('returns the same object when nothing matched', () => {
    const config = { enabled: true, statusRules: [], outcomeRules: [{ moveToStageId: 'keep' }] }
    expect(rewriteReferencedStageIds(config, remap)).toBe(config)
  })

  it('preserves draft/published config shape outside stage references', () => {
    const config = {
      enabled: true,
      allowedStatuses: ['A'],
      statusLabels: { A: 'label-1' },
      entryActions: [{ addLabelIds: ['l'] }],
      requiredWhen: { operator: 'and', conditions: [{ kind: 'field', name: 'X', op: 'eq', value: 'Y' }] }
    }
    expect(rewriteReferencedStageIds(config, remap)).toEqual(config)
  })
})
