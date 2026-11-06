import { describe, expect, it } from 'vitest'
import { formatDeadlineDate, parseDeadlineSpec, renderDeadline, resolveDeadlineDate } from './deadlineDate'

// Friday, November 6, 2026 (midday UTC — still Friday in Detroit, EDT)
const NOW = new Date('2026-11-06T15:00:00Z')

describe('parseDeadlineSpec', () => {
  it('parses offsets', () => {
    expect(parseDeadlineSpec('2 weeks')).toEqual({ count: 2, unit: 'weeks', business: false })
    expect(parseDeadlineSpec('10 business days')).toEqual({ count: 10, unit: 'days', business: true })
    expect(parseDeadlineSpec('3 calendar weeks')).toEqual({ count: 3, unit: 'weeks', business: false })
    expect(parseDeadlineSpec('5 days')).toEqual({ count: 5, unit: 'days', business: false })
  })

  it('parses snap modifiers with and without "to"', () => {
    expect(parseDeadlineSpec('2 weeks | snap friday')?.snapTo).toBe(5)
    expect(parseDeadlineSpec('2 weeks | snap to Monday')?.snapTo).toBe(1)
    expect(parseDeadlineSpec('snap friday')?.snapTo).toBe(5)
  })

  it('returns null for invalid specs', () => {
    expect(parseDeadlineSpec('bogus')).toBeNull()
    expect(parseDeadlineSpec('2 weeks | snap someday')).toBeNull()
    expect(parseDeadlineSpec('2 weeks | nonsense')).toBeNull()
    expect(parseDeadlineSpec('2 weeks | 3 days')).toBeNull()
  })
})

describe('resolveDeadlineDate', () => {
  it('adds calendar days and weeks', () => {
    expect(formatDeadlineDate(resolveDeadlineDate(parseDeadlineSpec('0 days')!, NOW))).toBe('Friday, November 6, 2026')
    expect(formatDeadlineDate(resolveDeadlineDate(parseDeadlineSpec('2 weeks')!, NOW))).toBe('Friday, November 20, 2026')
    expect(formatDeadlineDate(resolveDeadlineDate(parseDeadlineSpec('1 day')!, NOW))).toBe('Saturday, November 7, 2026')
  })

  it('skips weekends for business days', () => {
    // Friday + 1 business day → Monday
    expect(formatDeadlineDate(resolveDeadlineDate(parseDeadlineSpec('1 business day')!, NOW))).toBe('Monday, November 9, 2026')
    // Friday + 10 business days → Friday two weeks later
    expect(formatDeadlineDate(resolveDeadlineDate(parseDeadlineSpec('10 business days')!, NOW))).toBe('Friday, November 20, 2026')
    // Saturday send + 1 business day → Monday
    expect(formatDeadlineDate(resolveDeadlineDate(parseDeadlineSpec('1 business day')!, new Date('2026-11-07T15:00:00Z')))).toBe('Monday, November 9, 2026')
  })

  it('snaps to the next occurrence of the weekday, keeping same-day matches', () => {
    // 2 weeks lands on Friday already → stays
    expect(formatDeadlineDate(resolveDeadlineDate(parseDeadlineSpec('2 weeks | snap friday')!, NOW))).toBe('Friday, November 20, 2026')
    // 1 day lands Saturday → next Friday is a week later
    expect(formatDeadlineDate(resolveDeadlineDate(parseDeadlineSpec('1 day | snap friday')!, NOW))).toBe('Friday, November 13, 2026')
    // snap alone advances to next Monday
    expect(formatDeadlineDate(resolveDeadlineDate(parseDeadlineSpec('snap monday')!, NOW))).toBe('Monday, November 9, 2026')
  })
})

describe('renderDeadline', () => {
  it('renders the send date when the spec is empty', () => {
    expect(renderDeadline('', NOW)).toBe('Friday, November 6, 2026')
  })

  it('returns null for invalid specs', () => {
    expect(renderDeadline('bogus', NOW)).toBeNull()
  })
})
