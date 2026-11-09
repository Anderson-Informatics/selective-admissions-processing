import { describe, expect, it } from 'vitest'
import { detroitParts, nextOccurrence, occurrenceOn } from './scheduleTime'

describe('Detroit daily scheduling', () => {
  it('resolves standard and daylight time', () => {
    expect(occurrenceOn('2026-01-10', '06:00').toISOString()).toBe('2026-01-10T11:00:00.000Z')
    expect(occurrenceOn('2026-07-10', '06:00').toISOString()).toBe('2026-07-10T10:00:00.000Z')
  })
  it('runs missing spring times at the first valid minute', () => {
    expect(occurrenceOn('2026-03-08', '02:30').toISOString()).toBe('2026-03-08T07:00:00.000Z')
  })
  it('uses only the first repeated fall time', () => {
    expect(occurrenceOn('2026-11-01', '01:30').toISOString()).toBe('2026-11-01T05:30:00.000Z')
    expect(nextOccurrence('01:30', new Date('2026-11-01T06:00:00Z')).toISOString()).toBe('2026-11-02T06:30:00.000Z')
  })
  it('does not retroactively run on enable and respects local midnight', () => {
    expect(nextOccurrence('06:00', new Date('2026-01-10T11:00:00Z')).toISOString()).toBe('2026-01-11T11:00:00.000Z')
    expect(detroitParts(new Date('2026-01-10T03:00:00Z')).date).toBe('2026-01-09')
  })
})
