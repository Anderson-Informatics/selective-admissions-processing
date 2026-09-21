import { describe, expect, it } from 'vitest'
import { resolveRoutingTemplate } from './routingTemplates'

describe('routing template resolution', () => {
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
    expect(decision?.routing.outcomeRules[0]?.when).toMatchObject({ all: [{ stageId: 'decision-id' }] })
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
})
