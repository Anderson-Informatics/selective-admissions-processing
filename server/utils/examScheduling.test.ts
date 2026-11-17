import { describe, expect, it } from 'vitest'
import {
  assignGroups,
  classifySpecialGroup,
  detectSessions,
  examSessionForSubmission,
  examSessionTokens,
  EXAM_GROUP_DEFS,
  normalizeExamSchedulingConfig,
  type LabelInfo,
  type SchedulableSubmission
} from './examScheduling'

const labels: LabelInfo[] = [
  { externalId: 'hspt-jan', name: 'HSPT Jan 10' },
  { externalId: 'hspt-feb', name: 'HSPT Feb 7' },
  { externalId: 'iep', name: 'IEP' },
  { externalId: '504', name: '504 Plan' },
  { externalId: 'mll', name: 'MLL' },
  { externalId: 'exam-a', name: 'Exam A' },
  { externalId: 'exam-d', name: 'Exam D' },
  { externalId: 'green', name: '00-Green' },
  { externalId: 'blue', name: '00-Blue' }
]

const baseConfig = () => normalizeExamSchedulingConfig({
  iep504LabelIds: ['iep', '504'],
  mllLabelId: 'mll',
  groups: {
    'A-green': { min: 2, max: 3 },
    'A-blue': { min: 2, max: 3 },
    'B-green': { min: 0, max: 3 },
    'B-blue': { min: 0, max: 3 },
    'C-green': { min: 0, max: 3 },
    'C-blue': { min: 0, max: 3 },
    'D': { min: 0, max: 3 },
    'E': { min: 0, max: 3 },
    'F': { min: 0, max: 3 },
    'G': { min: 0, max: 3 }
  }
})

const sub = (id: string, overrides: Partial<SchedulableSubmission> = {}): SchedulableSubmission => ({
  submissionId: id,
  status: 'submitted',
  labelIds: ['hspt-jan'],
  reviewCompletion: [],
  ...overrides
})

const completeIepLedger = [{ name: 'IEP Review', required: true, complete: true }]

describe('detectSessions', () => {
  it('counts session labels and skips withdrawn submissions', () => {
    const result = detectSessions([
      sub('a'), sub('b'), sub('c', { labelIds: ['hspt-feb'] }),
      sub('w', { status: 'Withdrawn' })
    ], labels, '^HSPT\\s+')
    expect(result).toEqual([
      { labelId: 'hspt-feb', name: 'HSPT Feb 7', count: 1 },
      { labelId: 'hspt-jan', name: 'HSPT Jan 10', count: 2 }
    ])
  })
})

describe('classifySpecialGroup', () => {
  const config = baseConfig()

  it('returns RED when a required IEP review ledger entry is incomplete', () => {
    const submission = sub('x', {
      labelIds: ['hspt-jan', 'iep'],
      reviewCompletion: [{ name: 'IEP Review', required: true, complete: false }]
    })
    expect(classifySpecialGroup(submission, [], config)).toBe('RED')
  })

  it('returns RED when an IEP-labeled submission has no IEP ledger entry at all', () => {
    expect(classifySpecialGroup(sub('x', { labelIds: ['hspt-jan', '504'] }), [], config)).toBe('RED')
  })

  it('returns null (general pool) when accommodations say none required', () => {
    const submission = sub('x', { labelIds: ['hspt-jan', 'iep'], reviewCompletion: completeIepLedger })
    const reviews = [{ stageName: 'IEP Review', completedAt: new Date(), mappedData: { Accommodations: 'No Accommodations Required' } }]
    expect(classifySpecialGroup(submission, reviews, config)).toBeNull()
  })

  it('returns IEP504 for a completed review with real accommodations', () => {
    const submission = sub('x', { labelIds: ['hspt-jan', 'iep'], reviewCompletion: completeIepLedger })
    const reviews = [{ stageName: 'IEP Review', completedAt: new Date(), mappedData: { Accommodations: 'Extended time' } }]
    expect(classifySpecialGroup(submission, reviews, config)).toBe('IEP504')
  })

  it('returns MLL for the MLL label, but IEP/504 wins when both apply', () => {
    expect(classifySpecialGroup(sub('x', { labelIds: ['hspt-jan', 'mll'] }), [], config)).toBe('MLL')
    const both = sub('x', { labelIds: ['hspt-jan', 'mll', 'iep'], reviewCompletion: completeIepLedger })
    const reviews = [{ stageName: 'IEP Review', completedAt: new Date(), mappedData: { Accommodations: 'Extended time' } }]
    expect(classifySpecialGroup(both, reviews, config)).toBe('IEP504')
  })
})

describe('assignGroups', () => {
  const run = (submissions: SchedulableSubmission[], config = baseConfig(), reviews = new Map()) =>
    assignGroups({ submissions, labels, reviewsBySubmission: reviews, sessionLabelId: 'hspt-jan', config, random: () => 0.5 })

  it('keeps pre-assigned Exam+color groups', () => {
    const result = run([sub('keep', { labelIds: ['hspt-jan', 'exam-a', 'green'] })])
    expect(result.groups['A-green']).toEqual(['keep'])
  })

  it('keeps pre-assigned letter-only groups for D–G', () => {
    const result = run([sub('keep', { labelIds: ['hspt-jan', 'exam-d'] })])
    expect(result.groups.D).toEqual(['keep'])
  })

  it('returns letter-only A–C submissions to the pool with a diagnostic', () => {
    const result = run([sub('x', { labelIds: ['hspt-jan', 'exam-a'] })])
    expect(result.diagnostics.some(d => d.includes('no 00-Green/00-Blue'))).toBe(true)
    expect(result.assignments.x).toBeDefined()
  })

  it('fills groups to min first, then balances without exceeding max', () => {
    const submissions = Array.from({ length: 8 }, (_, i) => sub(`s${i}`))
    const result = run(submissions)
    expect(result.groups['A-green']!.length).toBeGreaterThanOrEqual(2)
    expect(result.groups['A-blue']!.length).toBeGreaterThanOrEqual(2)
    const counts = Object.entries(result.groups)
      .filter(([key]) => EXAM_GROUP_DEFS.find(d => d.key === key)?.schedulable)
      .map(([, ids]) => ids.length)
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(2)
    for (const def of EXAM_GROUP_DEFS.filter(d => d.schedulable)) {
      expect(result.groups[def.key]!.length).toBeLessThanOrEqual(3)
    }
  })

  it('overflows to Exam H when all groups are at max', () => {
    const config = baseConfig()
    for (const key of Object.keys(config.groups)) config.groups[key] = { min: 0, max: 1 }
    const submissions = Array.from({ length: 15 }, (_, i) => sub(`s${i}`))
    const result = run(submissions, config)
    expect(result.groups.H!.length).toBe(15 - 10)
    expect(result.diagnostics.some(d => d.includes('overflowed'))).toBe(true)
  })

  it('excludes withdrawn submissions', () => {
    const result = run([sub('w', { status: 'Withdrawn' }), sub('a')])
    expect(result.assignments.w).toBeUndefined()
    expect(result.assignments.a).toBeDefined()
  })

  it('routes special groups before pooling', () => {
    const red = sub('red', { labelIds: ['hspt-jan', 'iep'], reviewCompletion: [{ name: 'IEP Review', required: true, complete: false }] })
    const mll = sub('mll', { labelIds: ['hspt-jan', 'mll'] })
    const result = run([red, mll])
    expect(result.groups.RED).toEqual(['red'])
    expect(result.groups.MLL).toEqual(['mll'])
  })
})

describe('examSessionTokens / examSessionForSubmission', () => {
  const config = normalizeExamSchedulingConfig({
    groups: { RED: { min: 0, max: 0, note: 'Please bring a copy of your IEP.' } },
    schedules: {
      'hspt-jan': { sessionLabelId: 'hspt-jan', sessionName: 'HSPT Jan 10', generatedAt: 'x', assignments: { s1: 'B-green', s2: 'RED' } }
    }
  })

  it('emits group tokens', () => {
    expect(examSessionTokens('B-green', 'HSPT Jan 10', config)).toMatchObject({
      label: 'Exam B', arrivalTime: '9:20 a.m.', entrance: 'Main Entrance', date: 'HSPT Jan 10'
    })
    expect(examSessionTokens('RED', 'HSPT Jan 10', config).note).toBe('Please bring a copy of your IEP.')
  })

  it('resolves a persisted assignment for a submission', () => {
    expect(examSessionForSubmission('s1', config)?.label).toBe('Exam B')
    expect(examSessionForSubmission('s2', config)?.label).toBe('00-Red')
    expect(examSessionForSubmission('nope', config)).toBeUndefined()
  })
})
