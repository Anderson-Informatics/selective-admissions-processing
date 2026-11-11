import { describe, expect, it } from 'vitest'
import { selectDpscdSnapshot } from './dpscdSnapshots'
import { resolveGpa } from './routingEvaluator'

const rounds = [
  { key: 'early', name: 'Round 1', order: 1, active: true, startDate: new Date('2026-01-01'), endDate: new Date('2026-02-01') },
  { key: 'later', name: 'Round 2', order: 2, active: true, startDate: new Date('2026-02-02'), endDate: new Date('2026-03-01') }
]
const dpscd = { snapshots: { r1: { cumulativeGpa: 3.5, quartersAvailable: 5 }, all: { cumulativeGpa: 3.8, quartersAvailable: 9 } } }
const submission = { submissionId: 's1', mappedFields: {}, isMapped: true }

describe('DPSCD snapshot selection', () => {
  it('uses configured round order rather than the round key', () => {
    expect(selectDpscdSnapshot(dpscd, { completedAt: '2026-01-15' }, rounds)).toMatchObject({ selectedSnapshot: 'r1', selectedRound: 'early', cumulativeGpa: 3.5, quartersAvailable: 5 })
    expect(selectDpscdSnapshot(dpscd, { completedAt: '2026-02-15' }, rounds)).toMatchObject({ selectedSnapshot: 'all', cumulativeGpa: 3.8, quartersAvailable: 9 })
  })

  it('does not fall back for missing rounds or snapshots, even with cached values', () => {
    expect(selectDpscdSnapshot({ ...dpscd, cumulativeGpa: 4, quartersAvailable: 10 }, {}, rounds)).toMatchObject({ cumulativeGpa: undefined, quartersAvailable: undefined, selectionIssue: expect.stringContaining('missing_submission_date') })
    expect(selectDpscdSnapshot({ snapshots: { all: dpscd.snapshots.all } }, { completedAt: '2026-01-15' }, rounds)).toMatchObject({ cumulativeGpa: undefined, selectionIssue: 'Missing DPSCD r1 snapshot' })
  })

  it('keeps legacy single-snapshot records unchanged', () => {
    const legacy = { cumulativeGpa: 3.5, quartersAvailable: 6 }
    expect(selectDpscdSnapshot(legacy, {}, [])).toBe(legacy)
  })

  it('requires a usable completed review for partial DPSCD data, but not complete data', () => {
    const context = { submission, reviews: [], gpa: { dpscd: selectDpscdSnapshot(dpscd, { completedAt: '2026-01-15' }, rounds), optIn: { cumulativeGpa: 4 } } }
    expect(resolveGpa(context)).toMatchObject({ status: 'DPSCD Partial', cumulativeGpa: null })
    expect(resolveGpa({ ...context, reviews: [{ stageId: 'partial', stageName: 'Partial GPA', status: 'completed', mappedData: { PartialGPA: 3.6 } }] })).toMatchObject({ source: 'partial', cumulativeGpa: 3.6 })
    expect(resolveGpa({ ...context, reviews: [{ stageId: 'record', stageName: 'GPA Recording', status: 'completed', mappedData: { AbleToRecord: 'yes', CumulativeGPA: 3.7 } }] })).toMatchObject({ source: 'recording', cumulativeGpa: 3.7 })
    expect(resolveGpa({ submission, reviews: [], gpa: { dpscd: selectDpscdSnapshot(dpscd, { completedAt: '2026-02-15' }, rounds) } })).toEqual({ status: 'Complete', source: 'dpscd', cumulativeGpa: 3.8 })
  })
})
