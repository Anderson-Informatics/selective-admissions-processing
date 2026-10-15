import { describe, expect, it } from 'vitest'
import { resolveRoutingTemplate } from './routingTemplates'
import { routingTemplates } from '../config/seeds/routing'
import legacyAppHs from '../config/seeds/routing/app-hs.json'
import { evaluateConditionGroup, type RoutingContext } from './routingEvaluator'

describe('routing template resolution', () => {
  it('converts every bundled template group before it is served', () => {
    function check(value: unknown) {
      if (Array.isArray(value)) return value.forEach(check)
      if (!value || typeof value !== 'object') return
      const record = value as Record<string, unknown>
      expect(record).not.toHaveProperty('all')
      expect(record).not.toHaveProperty('any')
      Object.values(record).forEach(check)
    }
    Object.values(routingTemplates).forEach(check)
  })
  it('serves bundled templates with nested AND/OR groups equivalent to their legacy input', () => {
    const legacy = legacyAppHs.stages['Decision Review'].routing.outcomeRules[0]!.when
    const current = routingTemplates['app-hs'].stages['Decision Review'].routing.outcomeRules[0]!.when
    expect(current).toMatchObject({ operator: 'and', conditions: [{ kind: 'reviewScore' }] })
    const context: RoutingContext = {
      submission: { submissionId: 'sub', mappedFields: {}, isMapped: true },
      reviews: [{ stageId: 'review', score: 10, completedAt: '2026-01-01' }]
    }
    for (const score of [10, -5, 0]) {
      context.reviews[0]!.score = score
      expect(evaluateConditionGroup(current, context)).toBe(evaluateConditionGroup(legacy, context))
    }
  })
  it('resolves symbolic App-HS stage references to local stageIds', () => {
    const result = resolveRoutingTemplate('app-hs', [
      { stageId: 'completion-id', name: 'Completion Review' },
      { stageId: 'decision-id', name: 'Decision Review' },
      { stageId: 'accepted-id', name: 'Accepted' },
      { stageId: 'declined-id', name: 'Declined' },
      { stageId: 'withdrawn-id', name: 'Withdrawn Application' }
    ])
    const decision = result.stages.find(stage => stage.stageId === 'decision-id')
    const decline = decision?.routing.outcomeRules.find(rule => rule.name === 'decline')

    expect(result.warnings).toEqual([])
    expect(decline).toMatchObject({ moveToStageId: 'declined-id' })
    expect(decision?.routing.outcomeRules[0]?.when).toMatchObject({ operator: 'and', conditions: [{ stageId: 'decision-id' }] })
  })

  it('reports missing symbolic stage references without throwing', () => {
    const result = resolveRoutingTemplate('app-hs', [
      { stageId: 'decision-id', name: 'Decision Review' }
    ])

    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.stages.find(stage => stage.stageId === 'decision-id')?.routing.enabled).toBe(true)
  })

  it('disables draft templates when resolved', () => {
    const result = resolveRoutingTemplate('ehs-9th-grade', [
      { stageId: 'essay-id', name: 'Essay Scoring' },
      { stageId: 'gpa-id', name: 'GPA Recording' }
    ])

    expect(result.draft).toBe(true)
    expect(result.stages.every(stage => stage.routing.enabled === false)).toBe(true)
  })

  it('uses each accepted stage’s own review form for enrollment status', () => {
    const names = ['CT Accepted', 'MLK Accepted', 'MG Accepted', 'RHS Accepted', 'SE Accepted']
    const stages = names.map((name, index) => ({ name, stageId: `accepted-${index}` }))
    const result = resolveRoutingTemplate('ehs-9th-grade', stages)

    expect(result.warnings).toEqual([])
    for (const [index, stage] of result.stages.entries()) {
      const rule = stage.routing.statusRules[0]!
      expect(rule).toMatchObject({
        name: 'enrollment submitted',
        status: 'Enrollment Submitted',
        when: { operator: 'and', conditions: [{
          kind: 'reviewField',
          stageId: stages[index]!.stageId,
          field: 'enrollmentStatus',
          op: 'eq',
          value: 'Submitted'
        }] }
      })
      expect(stage.routing.statusRules[1]).toMatchObject({ name: 'default', status: 'Accepted' })

      const context: RoutingContext = {
        submission: { submissionId: 'sub', mappedFields: {}, isMapped: true },
        reviews: [{ stageId: stage.stageId, mappedData: { enrollmentStatus: 'Submitted' }, completedAt: '2026-01-01' }]
      }
      expect(evaluateConditionGroup(rule.when, context)).toBe(true)
      context.reviews[0]!.stageId = stages[(index + 1) % stages.length]!.stageId
      expect(evaluateConditionGroup(rule.when, context)).toBe(false)
    }
  })
})
