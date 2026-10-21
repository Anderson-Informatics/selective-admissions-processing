import { describe, expect, it } from 'vitest'
import { normalizeCycleRounds, resolveSubmissionRound } from './cycleRounds'
import { buildReviewCompletionForSubmission } from './reviewCompletionRefresh'
import { computeReviewCompletion, deriveGpaStatus, evaluateCondition, routeSubmission, type RoutingContext, type RoutingStage } from './routingEvaluator'

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
    mappedFields: {},
    isMapped: true,
    labelIds: [],
    currentStageId: 'new'
  },
  reviews: [],
  ...overrides
})

describe('review completion evaluator', () => {
  it('classifies an uploaded Opt-In GPA with explicitly insufficient attendance as OOD Partial', () => {
    const partial = context({
      submission: { ...context().submission, mappedFields: { CumulativeGPA: 3.5 } },
      gpa: { optIn: { enrolledMinTerms: 'no', enrolledMinTermsFlag: false, termsEnrolled: 2, cumulativeGpa: 3.2 } }
    })

    expect(deriveGpaStatus(partial)).toBe('OOD Partial')
    expect(evaluateCondition({ kind: 'gpaStatus', op: 'eq', value: 'OOD Partial' }, partial)).toBe(true)
    expect(buildReviewCompletionForSubmission(partial.submission, [], [], partial.gpa).gpaStatus).toBe('OOD Partial')
  })

  it('does not classify sufficient or unanswered Opt-In attendance as OOD Partial', () => {
    for (const attendance of ['yes', ''] as const) {
      expect(deriveGpaStatus(context({
        gpa: { optIn: { enrolledMinTerms: attendance, enrolledMinTermsFlag: attendance === 'yes', cumulativeGpa: 3.2 } }
      }))).toBe('Complete')
    }
    expect(deriveGpaStatus(context({ gpa: { dpscd: { quartersAvailable: 4 } } }))).toBe('DPSCD Partial')
    expect(deriveGpaStatus(context())).toBe('Incomplete')
  })

  it('builds a persistence-ready ledger from plain submission data', () => {
    const result = buildReviewCompletionForSubmission({
      submissionId: 'sub-1',
      mappedFields: {},
      isMapped: true,
      labelIds: [],
      currentStageId: 'essay'
    }, [stage('essay', 10, 'work', { statusRules: [{ name: 'default', status: 'Needs Two Reviews', complete: false }] })])

    expect(result.reviewCompletion).toEqual([expect.objectContaining({ stageId: 'essay', status: 'Needs Two Reviews', complete: false })])
  })

  it('marks a mapped initial stage complete', () => {
    const result = computeReviewCompletion([
      stage('new', 0, 'initial'),
      stage('essay', 10, 'work')
    ], context())

    expect(result.reviewCompletion[0]).toMatchObject({ stageId: 'new', required: true, status: 'Mapped', complete: true })
  })

  it('selects the earliest of multiple required incomplete stages without warning', () => {
    const stages = [
      stage('essay', 10, 'work'),
      stage('new', 0, 'initial'),
      stage('gpa', 5, 'work')
    ]
    const completion = computeReviewCompletion(stages, context())
    const decision = routeSubmission(stages, context())

    expect(completion.reviewCompletion.map(entry => entry.stageId)).toEqual(['new', 'gpa', 'essay'])
    expect(completion.diagnostics).toEqual([])
    expect(decision).toMatchObject({ action: 'move', reason: 'next_required', toStageId: 'gpa', diagnostics: [] })
  })

  it('routes a completed round-one IEP application to its earlier required stage', () => {
    const rounds = normalizeCycleRounds([
      { key: 'round-1', name: 'Round 1', order: 1, startDate: '2026-10-12', endDate: '2027-01-31' }
    ])
    const submission = { ...context().submission, mappedFields: { IEPorNPSPor504: 'IEP or NPSP', DPSCD: 'No' }, completedAt: new Date('2026-10-21') }
    const decision = routeSubmission([
      stage('new', 0, 'initial'),
      stage('iep-completion', 1, 'work', { requiredWhen: { operator: 'and', conditions: [
        { kind: 'field', name: 'IEPorNPSPor504', op: 'eq', value: 'IEP or NPSP' },
        { kind: 'cycleRound', op: 'eq', value: 'round-1' },
        { kind: 'field', name: 'DPSCD', op: 'ne', value: 'Yes' }
      ] } }),
      stage('gpa-completion', 5, 'work', { requiredWhen: { operator: 'and', conditions: [{ kind: 'gpaStatus', op: 'eq', value: 'Incomplete' }] } })
    ], context({ submission, cycleRound: resolveSubmissionRound(submission, rounds).key }))

    expect(decision).toMatchObject({ action: 'move', toStageId: 'iep-completion', reason: 'next_required' })
  })

  it('keeps final stages incomplete for ledger reporting', () => {
    const result = computeReviewCompletion([
      stage('accepted', 100, 'final', {
        statusRules: [{ name: 'final', status: 'Accepted', complete: true }]
      })
    ], context())

    expect(result.reviewCompletion[0]).toMatchObject({ role: 'final', required: false, status: 'Accepted', complete: false })
  })

  it('calculates required stages even when routing execution is disabled', () => {
    const result = computeReviewCompletion([
      stage('essay', 10, 'work', {
        enabled: false,
        requiredWhen: { all: [] },
        statusRules: [{ name: 'default', status: 'Needs Essay Review', complete: false }]
      })
    ], context())

    expect(result.reviewCompletion[0]).toMatchObject({ required: true, status: 'Needs Essay Review', complete: false })
    expect(routeSubmission([
      stage('essay', 10, 'work', {
        enabled: false,
        requiredWhen: { all: [] }
      })
    ], context({ submission: { ...context().submission, currentStageId: undefined } }))).toMatchObject({ action: 'stay' })
  })

  it('selects GPA Pending while external data is missing', () => {
    const stages = [
      stage('gpa-pending', 20, 'hold', {
        requiredWhen: { all: [
          { kind: 'label', op: 'hasLabel', labelId: 'opt-in' },
          { kind: 'gpaRecord', source: 'any', exists: false }
        ] }
      }),
      stage('gpa-recording', 30, 'work', {
        requiredWhen: { all: [{ kind: 'gpaStatus', op: 'in', value: ['DPSCD Partial', 'Partial'] }] }
      })
    ]
    const result = computeReviewCompletion(stages, context({
      submission: { ...context().submission, labelIds: ['opt-in'] }
    }))

    expect(result.reviewCompletion).toEqual(expect.arrayContaining([
      expect.objectContaining({ stageId: 'gpa-pending', required: true, complete: false }),
      expect.objectContaining({ stageId: 'gpa-recording', required: false })
    ]))
  })

  it('clears GPA Pending and selects GPA Recording for insufficient DPSCD history', () => {
    const stages = [
      stage('gpa-pending', 20, 'hold', {
        requiredWhen: { all: [
          { kind: 'label', op: 'hasLabel', labelId: 'dpscd' },
          { kind: 'gpaRecord', source: 'dpscd', exists: false }
        ] }
      }),
      stage('gpa-recording', 30, 'work', {
        requiredWhen: { all: [
          { kind: 'gpaStatus', op: 'eq', value: 'DPSCD Partial' }
        ] },
        statusRules: [{ name: 'default', status: 'Needs GPA Recording', complete: false }]
      })
    ]
    const result = computeReviewCompletion(stages, context({
      submission: { ...context().submission, labelIds: ['dpscd'] },
      gpa: { dpscd: { quartersAvailable: 4 } }
    }))

    expect(result.reviewCompletion).toEqual([
      expect.objectContaining({ stageId: 'gpa-pending', required: false }),
      expect.objectContaining({ stageId: 'gpa-recording', required: true, status: 'Needs GPA Recording', complete: false })
    ])
  })

  it('requires GPA Recording until GPA and AbleToRecord are valid', () => {
    const recording = stage('gpa-recording', 30, 'work', {
      statusRules: [
        {
          name: 'complete',
          when: { all: [
            { kind: 'field', name: 'CumulativeGPA', op: 'gte', value: 0 },
            { kind: 'field', name: 'CumulativeGPA', op: 'lte', value: 4.3 },
            { kind: 'field', name: 'AbleToRecord', op: 'eq', value: 'Yes' }
          ] },
          status: 'GPA Complete',
          complete: true
        },
        { name: 'default', status: 'Needs GPA Recording', complete: false }
      ]
    })

    const incomplete = computeReviewCompletion([recording], context({
      submission: { ...context().submission, mappedFields: { CumulativeGPA: 4.1, AbleToRecord: 'No' } }
    }))
    const complete = computeReviewCompletion([recording], context({
      submission: { ...context().submission, mappedFields: { CumulativeGPA: 4.3, AbleToRecord: 'Yes' } }
    }))

    expect(incomplete.reviewCompletion[0]).toMatchObject({ complete: false, status: 'Needs GPA Recording' })
    expect(complete.reviewCompletion[0]).toMatchObject({ complete: true, status: 'GPA Complete' })
  })

  it('uses essay review count and spread to mark a third review needed', () => {
    const essay = stage('essay', 40, 'work', {
      statusRules: [
        {
          name: 'third',
          when: { all: [
            { kind: 'reviewCount', stageIds: ['essay'], op: 'eq', value: 2 },
            { kind: 'reviewSpread', stageId: 'essay', op: 'gte', value: 6 }
          ] },
          status: 'Needs Third Review',
          complete: false
        },
        { name: 'default', status: 'Needs Two Reviews', complete: false }
      ]
    })
    const result = computeReviewCompletion([essay], context({
      reviews: [
        { stageId: 'essay', score: 10, status: 'completed', completedAt: '2026-01-01' },
        { stageId: 'essay', score: 3, status: 'completed', completedAt: '2026-01-02' }
      ]
    }))

    expect(result.reviewCompletion[0]).toMatchObject({ status: 'Needs Third Review', complete: false })
  })

  it('selects only the DSA audition stage matching AuditionArea', () => {
    const stages = [
      stage('dance', 20, 'work', { requiredWhen: { all: [{ kind: 'field', name: 'AuditionArea', op: 'eq', value: 'Dance' }] } }),
      stage('vocal', 21, 'work', { requiredWhen: { all: [{ kind: 'field', name: 'AuditionArea', op: 'eq', value: 'Vocal Music' }] } })
    ]
    const result = computeReviewCompletion(stages, context({
      submission: { ...context().submission, mappedFields: { AuditionArea: 'Vocal Music' } }
    }))

    expect(result.reviewCompletion).toEqual([
      expect.objectContaining({ stageId: 'dance', required: false }),
      expect.objectContaining({ stageId: 'vocal', required: true })
    ])
  })

  it('moves from NO EXAM to Ready for Placement when HSPT is linked', () => {
    const stages = [
      stage('no-exam', 90, 'hold', {
        requiredWhen: { all: [
          { kind: 'pipelinePrerequisitesComplete' },
          { kind: 'hsptLinked', exists: false }
        ] }
      }),
      stage('ready', 100, 'work', {
        requiredWhen: { all: [
          { kind: 'pipelinePrerequisitesComplete' },
          { kind: 'hsptLinked', exists: true }
        ] }
      })
    ]
    const result = routeSubmission(stages, context({
      submission: { ...context().submission, currentStageId: 'no-exam', hsptResultId: 'hspt-1' },
      prerequisitesComplete: true
    }))

    expect(result).toMatchObject({ action: 'move', toStageId: 'ready', reason: 'next_required' })
  })

  it('applies App-HS outcome overrides before next-stage selection', () => {
    const decision = stage('decision', 20, 'work', {
      outcomeRules: [{
        name: 'decline',
        enabled: true,
        when: { all: [{ kind: 'reviewScore', stageId: 'decision', op: 'eq', value: -5 }] },
        moveToStageId: 'declined'
      }]
    })
    const declined = stage('declined', 30, 'final')
    const result = routeSubmission([decision, declined], context({
      submission: { ...context().submission, currentStageId: 'decision' },
      reviews: [{ stageId: 'decision', score: -5, status: 'completed', completedAt: '2026-01-01' }]
    }))

    expect(result).toMatchObject({ action: 'move', toStageId: 'declined', reason: 'outcome' })
  })

  it('still reports an outcome rule targeting a missing stage', () => {
    const result = routeSubmission([
      stage('new', 0, 'initial', { outcomeRules: [{
        name: 'missing destination',
        enabled: true,
        when: { operator: 'and', conditions: [] },
        moveToStageId: 'missing'
      }] }),
      stage('essay', 10, 'work')
    ], context())

    expect(result).toMatchObject({
      action: 'stay',
      reason: 'invalid_target',
      diagnostics: [{ code: 'invalid_target_stage', stageIds: ['missing'] }]
    })
  })
})
