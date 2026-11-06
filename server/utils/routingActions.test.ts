import { describe, expect, it } from 'vitest'
import type { RoutingContext, RoutingDecision, RoutingStage } from './routingEvaluator'
import { matchedOutcomeRule, renderMergeFields, resolveRoutingActions, splitListValue } from './routingActions'

const stage = (stageId: string, order: number, role: RoutingStage['role'], routing: Partial<RoutingStage['routing']> = {}): RoutingStage => ({
  stageId,
  name: stageId,
  order,
  role,
  routing: {
    enabled: true,
    statusRules: [],
    outcomeRules: [],
    entryActions: [],
    exitActions: [],
    ...routing
  }
})

const context = (overrides: Partial<RoutingContext> = {}): RoutingContext => ({
  submission: {
    submissionId: 'sub-1',
    mappedFields: { FirstName: 'Ada', StudentNumber: '12345' },
    isMapped: true,
    labelIds: [],
    currentStageId: 'new'
  },
  reviews: [],
  ...overrides
})

const moveDecision: RoutingDecision = { action: 'move', reason: 'next_required', fromStageId: 'new', toStageId: 'gpa', backward: false, diagnostics: [] }

describe('resolveRoutingActions', () => {
  it('returns only the move when no side actions are configured', () => {
    const stages = [stage('new', 0, 'initial'), stage('gpa', 1, 'work')]
    const actions = resolveRoutingActions(stages, context(), moveDecision, [])
    expect(actions.move?.toStageId).toBe('gpa')
    expect(actions.labelsToAdd).toEqual([])
    expect(actions.openForEditing).toBeUndefined()
  })

  it('collects exit, outcome, and entry actions for a move', () => {
    const stages = [
      stage('new', 0, 'initial', {
        outcomeRules: [{ name: 'out', enabled: true, when: { operator: 'and', conditions: [] }, moveToStageId: 'gpa', addLabelIds: ['outcome-label'] }],
        exitActions: [{ removeLabelIds: ['old-label'], unassignUserIds: ['user-1'] }]
      }),
      stage('gpa', 1, 'work', {
        entryActions: [{ addLabelIds: ['entry-label'], assignUserIds: ['user-2'], openForEditing: { templateId: 'tpl-1' } }]
      })
    ]
    const decision: RoutingDecision = { ...moveDecision, reason: 'outcome' }
    const actions = resolveRoutingActions(stages, context(), decision, [])
    expect(actions.labelsToAdd.sort()).toEqual(['entry-label', 'outcome-label'])
    expect(actions.labelsToRemove).toEqual(['old-label'])
    expect([...actions.assignUserIds]).toEqual(['user-2'])
    expect([...actions.unassignUserIds]).toEqual(['user-1'])
    expect(actions.openForEditing?.templateId).toBe('tpl-1')
  })

  it('respects the when condition on entry and exit actions', () => {
    const stages = [
      stage('new', 0, 'initial', {
        exitActions: [{ when: { operator: 'and', conditions: [{ kind: 'field', name: 'Missing', op: 'eq', value: 'Yes' }] }, addLabelIds: ['skip-me'] }]
      }),
      stage('gpa', 1, 'work', {
        entryActions: [{ when: { operator: 'and', conditions: [{ kind: 'field', name: 'FirstName', op: 'eq', value: 'Ada' }] }, addLabelIds: ['apply-me'] }]
      })
    ]
    const actions = resolveRoutingActions(stages, context(), moveDecision, [])
    expect(actions.labelsToAdd).toEqual(['apply-me'])
  })

  it('syncs statusLabels for enabled stages even without a move', () => {
    const stages = [
      stage('essay', 1, 'work', { statusLabels: { 'Needs Two Reviews': 'label-two', 'Essay Scoring Complete': 'label-done' } })
    ]
    const stay: RoutingDecision = { action: 'stay', reason: 'already_current', fromStageId: 'essay', backward: false, diagnostics: [] }
    const actions = resolveRoutingActions(stages, context({ submission: { submissionId: 'sub-1', mappedFields: {}, isMapped: true, currentStageId: 'essay' } }), stay, [
      { stageId: 'essay', status: 'Needs Two Reviews' }
    ])
    expect(actions.move).toBeUndefined()
    expect(actions.labelsToAdd).toEqual(['label-two'])
    expect(actions.labelsToRemove).toEqual(['label-done'])
    expect(actions.statusLabelIds).toEqual(['label-two'])
    expect(actions.statusLabelSync).toBe(true)
  })

  it('removes all mapped status labels when the status has no mapping', () => {
    const stages = [
      stage('essay', 1, 'work', { statusLabels: { 'Needs Two Reviews': 'label-two', 'Essay Scoring Complete': 'label-done' } })
    ]
    const stay: RoutingDecision = { action: 'stay', reason: 'already_current', backward: false, diagnostics: [] }
    const actions = resolveRoutingActions(stages, context(), stay, [{ stageId: 'essay', status: 'Something Else' }])
    expect(actions.labelsToAdd).toEqual([])
    expect(actions.labelsToRemove.sort()).toEqual(['label-done', 'label-two'])
  })

  it('emits a set_fields_deferred diagnostic instead of applying setFields', () => {
    const stages = [
      stage('new', 0, 'initial'),
      stage('gpa', 1, 'work', { entryActions: [{ setFields: { GPABonusEligible: 'Yes' } }] })
    ]
    const actions = resolveRoutingActions(stages, context(), moveDecision, [])
    expect(actions.diagnostics.some(d => d.code === 'set_fields_deferred')).toBe(true)
  })
})

describe('matchedOutcomeRule', () => {
  it('returns the first enabled matching outcome rule of the current stage', () => {
    const stages = [
      stage('new', 0, 'initial', {
        outcomeRules: [
          { name: 'skip', enabled: false, when: { operator: 'and', conditions: [] }, moveToStageId: 'x' },
          { name: 'hit', enabled: true, when: { operator: 'and', conditions: [{ kind: 'field', name: 'FirstName', op: 'eq', value: 'Ada' }] }, moveToStageId: 'gpa' }
        ]
      })
    ]
    const rule = matchedOutcomeRule(stages, context())
    expect(rule?.name).toBe('hit')
  })

  it('returns undefined when the current stage routing is disabled', () => {
    const stages = [stage('new', 0, 'initial', { enabled: false, outcomeRules: [{ name: 'x', enabled: true, when: { operator: 'and', conditions: [] }, moveToStageId: 'x' }] })]
    expect(matchedOutcomeRule(stages, context())).toBeUndefined()
  })
})

describe('renderMergeFields', () => {
  it('replaces submission field tokens', () => {
    const { text, unresolved } = renderMergeFields('Hi {{FirstName}}, id {{StudentNumber}}', context())
    expect(text).toBe('Hi Ada, id 12345')
    expect(unresolved).toEqual([])
  })

  it('resolves stage-scoped review field tokens', () => {
    const ctx = context({
      reviews: [{
        stageId: 'gpa',
        stageName: 'GPA Completion',
        status: 'complete',
        completedAt: new Date('2026-10-01'),
        mappedData: { RequirementsSatisfied: 'No', Issues: 'Missing transcript' }
      }]
    })
    const { text } = renderMergeFields('Status: {{GPA Completion.RequirementsSatisfied}} — {{GPA Completion.Issues}}', ctx)
    expect(text).toBe('Status: No — Missing transcript')
  })

  it('uses the latest completed review for a stage', () => {
    const ctx = context({
      reviews: [
        { stageId: 'gpa', stageName: 'GPA Completion', status: 'complete', completedAt: new Date('2026-09-01'), mappedData: { Issues: 'Old' } },
        { stageId: 'gpa', stageName: 'GPA Completion', status: 'complete', completedAt: new Date('2026-10-01'), mappedData: { Issues: 'New' } }
      ]
    })
    expect(renderMergeFields('{{GPA Completion.Issues}}', ctx).text).toBe('New')
  })

  it('reports unresolved tokens and renders them empty', () => {
    const { text, unresolved } = renderMergeFields('A {{Unknown}} B', context())
    expect(text).toBe('A  B')
    expect(unresolved).toEqual(['Unknown'])
  })

  it('ignores review tokens from incomplete reviews', () => {
    const ctx = context({
      reviews: [{ stageId: 'gpa', stageName: 'GPA Completion', status: 'in_progress', mappedData: { Issues: 'Draft' } }]
    })
    const { unresolved } = renderMergeFields('{{GPA Completion.Issues}}', ctx)
    expect(unresolved).toEqual(['GPA Completion.Issues'])
  })
})

describe('renderMergeFields list formats', () => {
  const issuesContext = (issues: unknown) => context({
    reviews: [{ stageId: 'gpa', stageName: 'GPA Completion', status: 'complete', completedAt: new Date('2026-10-01'), mappedData: { Issues: issues } }]
  })
  const optionLabels = { Issues: ['Missing transcript', 'Grades; incomplete', 'Unsigned'] }

  it('renders a standalone list token as a bulleted list block', () => {
    const { text } = renderMergeFields('<p>Issues:</p><p>{{GPA Completion.Issues | list}}</p>', issuesContext('Missing transcript; Unsigned'), { mode: 'html' })
    expect(text).toBe('<p>Issues:</p><ul><li>Missing transcript</li><li>Unsigned</li></ul>')
  })

  it('renders numbered lists', () => {
    const { text } = renderMergeFields('<p>{{GPA Completion.Issues | numbered}}</p>', issuesContext('A; B'), { mode: 'html' })
    expect(text).toBe('<ol><li>A</li><li>B</li></ol>')
  })

  it('splits by known option labels that contain semicolons', () => {
    const { text } = renderMergeFields('<p>{{GPA Completion.Issues | list}}</p>', issuesContext('Grades; incomplete; Unsigned'), { mode: 'html', optionLabels })
    expect(text).toBe('<ul><li>Grades; incomplete</li><li>Unsigned</li></ul>')
  })

  it('falls back to comma style for inline list tokens and in plain text', () => {
    const ctx = issuesContext('A; B; C')
    expect(renderMergeFields('<p>We found {{GPA Completion.Issues | list}}.</p>', ctx, { mode: 'html' }).text).toBe('<p>We found A, B and C.</p>')
    expect(renderMergeFields('Issues: {{GPA Completion.Issues | numbered}}', ctx).text).toBe('Issues: A, B and C')
    expect(renderMergeFields('{{GPA Completion.Issues | comma}}', issuesContext('A; B')).text).toBe('A and B')
  })

  it('removes the paragraph when nothing was selected', () => {
    const { text } = renderMergeFields('<p>Hi</p><p>{{GPA Completion.Issues | list}}</p>', issuesContext(''), { mode: 'html' })
    expect(text).toBe('<p>Hi</p>')
  })

  it('escapes values in html mode without re-scanning rendered values', () => {
    const { text } = renderMergeFields('<p>{{GPA Completion.Issues | list}}</p><p>{{GPA Completion.Issues}}</p>', issuesContext('<b>x</b> & {{FirstName}}'), { mode: 'html' })
    expect(text).toBe('<ul><li>&lt;b&gt;x&lt;/b&gt; &amp; {{FirstName}}</li></ul><p>&lt;b&gt;x&lt;/b&gt; &amp; {{FirstName}}</p>')
  })

  it('leaves unformatted tokens unchanged and flags unknown formats', () => {
    const ctx = issuesContext('A; B')
    expect(renderMergeFields('{{GPA Completion.Issues}}', ctx).text).toBe('A; B')
    const result = renderMergeFields('{{GPA Completion.Issues | foo}}', ctx)
    expect(result.text).toBe('A; B')
    expect(result.unknownFormats).toEqual(['GPA Completion.Issues | foo'])
  })
})

describe('splitListValue', () => {
  it('handles arrays and plain strings', () => {
    expect(splitListValue(['A', ' B '])).toEqual(['A', 'B'])
    expect(splitListValue('A;B;  C')).toEqual(['A', 'B', 'C'])
    expect(splitListValue(undefined)).toEqual([])
  })
})
