import { describe, expect, it } from 'vitest'
import { normalizeCycleRounds, resolveCycleRound } from './cycleRounds'

describe('cycle rounds', () => {
  const rounds = normalizeCycleRounds([
    { key: 'round-1', name: 'Round 1', order: 1, startDate: '2025-10-01', endDate: '2026-01-31', active: true },
    { key: 'round-2', name: 'Round 2', order: 2, startDate: '2026-02-01', endDate: '2026-05-31', active: true }
  ])

  it('resolves inclusive submission dates', () => {
    expect(resolveCycleRound('2025-10-01', rounds).key).toBe('round-1')
    expect(resolveCycleRound('2026-01-31', rounds).key).toBe('round-1')
    expect(resolveCycleRound('2026-02-01', rounds).key).toBe('round-2')
  })

  it('reports missing and outside dates', () => {
    expect(resolveCycleRound(undefined, rounds).status).toBe('missing_submission_date')
    expect(resolveCycleRound('2026-09-01', rounds).status).toBe('outside_configured_ranges')
  })

  it('rejects overlapping ranges', () => {
    expect(() => normalizeCycleRounds([
      { key: 'round-1', name: 'Round 1', order: 1, startDate: '2025-10-01', endDate: '2026-02-01', active: true },
      { key: 'round-2', name: 'Round 2', order: 2, startDate: '2026-02-01', endDate: '2026-05-31', active: true }
    ])).toThrow(/overlaps/)
  })
})
