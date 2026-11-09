import { describe, expect, it } from 'vitest'
import { computeGpaScore, deriveGpaMultiplier, gpaTablePoints, normalizeOptionLabel } from './gpaScoring'

describe('gpaTablePoints', () => {
  it.each([
    [4.0, 30], [3.91, 30], [3.9, 29], [3.85, 29], [3.0, 20], [2.95, 20],
    [1.55, 6], [1.5, 5], [1.0, 5], [0.01, 5], [0, 0], [null, 0], [undefined, 0]
  ])('maps %s to %i points', (gpa, expected) => {
    expect(gpaTablePoints(gpa)).toBe(expected)
  })

  it('honors a custom table', () => {
    const table = [{ minGpa: 3.95, points: 30 }, { minGpa: 3.0, points: 20 }]
    expect(gpaTablePoints(3.96, table)).toBe(30)
    expect(gpaTablePoints(3.9, table)).toBe(20)
    expect(gpaTablePoints(3.0, table)).toBe(0)
  })
})

describe('computeGpaScore', () => {
  it('returns pts * multiplier + bonus', () => {
    expect(computeGpaScore(3.95, 1, 0)).toBe(30)
    expect(computeGpaScore(3.95, 0.8, 5)).toBe(29)
    expect(computeGpaScore(3.55, 0.6, 0)).toBeCloseTo(15.6)
  })

  it('returns 0 when no table points apply', () => {
    expect(computeGpaScore(null, 1, 5)).toBe(0)
    expect(computeGpaScore(0, 1, 5)).toBe(0)
  })
})

describe('deriveGpaMultiplier', () => {
  it('returns 1 for resolved recording, optIn, or DPSCD >= 6 quarters', () => {
    expect(deriveGpaMultiplier({ resolvedSource: 'recording', hasResolvedGpa: true })).toBe(1)
    expect(deriveGpaMultiplier({ resolvedSource: 'optIn', hasResolvedGpa: true })).toBe(1)
    expect(deriveGpaMultiplier({ resolvedSource: 'dpscd', hasResolvedGpa: true, quartersAvailable: 6 })).toBe(1)
  })

  it('maps Semesters option text to the legacy values', () => {
    const base = { resolvedSource: 'partial', hasResolvedGpa: true }
    expect(deriveGpaMultiplier({ ...base, semesters: 'More than 1 year (5 quarters, 4 trimesters' })).toBe(0.8)
    expect(deriveGpaMultiplier({ ...base, semesters: 'One Year ( or 2 semesters or 3 trimesters)' })).toBe(0.6)
    expect(deriveGpaMultiplier({ ...base, semesters: 'One semester (or 2-3 quarters)' })).toBe(0.4)
    expect(deriveGpaMultiplier({ ...base, semesters: 'One quarter' })).toBe(0.2)
    expect(deriveGpaMultiplier({ ...base, semesters: 'None - Progress report or GPA could not be calculated' })).toBe(0)
  })

  it('falls back to quarters when Semesters is unrecognized', () => {
    const base = { resolvedSource: null, hasResolvedGpa: false }
    expect(deriveGpaMultiplier({ ...base, quartersAvailable: 5 })).toBe(0.8)
    expect(deriveGpaMultiplier({ ...base, quartersAvailable: 4 })).toBe(0.6)
    expect(deriveGpaMultiplier({ ...base, quartersAvailable: 3 })).toBe(0.4)
    expect(deriveGpaMultiplier({ ...base, quartersAvailable: 2 })).toBe(0.4)
    expect(deriveGpaMultiplier({ ...base, quartersAvailable: 1 })).toBe(0.2)
    expect(deriveGpaMultiplier({ ...base, quartersAvailable: 0 })).toBe(0)
    expect(deriveGpaMultiplier({ ...base, quartersAvailable: null })).toBe(0)
  })

  it('prefers Semesters over quarters when both present', () => {
    expect(deriveGpaMultiplier({ resolvedSource: 'partial', hasResolvedGpa: true, semesters: 'One quarter', quartersAvailable: 5 })).toBe(0.2)
  })
})

describe('normalizeOptionLabel', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeOptionLabel('  One   Quarter ')).toBe('one quarter')
    expect(normalizeOptionLabel(undefined)).toBe('')
  })
})
