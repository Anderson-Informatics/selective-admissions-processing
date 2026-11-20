import { describe, expect, it } from 'vitest'
import { editingDate, editingState, literalSearch } from './submissionEditing'

describe('source editing metadata', () => {
  it('uses entry status rather than lifecycle status or timestamp presence', () => {
    expect(editingState('editable')).toBe('open')
    expect(editingState('complete')).toBe('closed')
    for (const status of [undefined, null, '', 'Accepted', 'active', 'incomplete', 'Editable']) expect(editingState(status)).toBe('unknown')
  })

  it('accepts valid API dates and rejects missing or invalid dates', () => {
    expect(editingDate('2021-07-26T21:12:29.1744300Z')?.toISOString()).toBe('2021-07-26T21:12:29.174Z')
    expect(editingDate(new Date('2026-01-01'))).toEqual(new Date('2026-01-01'))
    for (const value of [undefined, null, '', 'not a date', new Date('invalid'), 0]) expect(editingDate(value)).toBeUndefined()
  })

  it('escapes search expressions as literal text', () => {
    expect(literalSearch('A.*(B)[C]$\\')).toBe('A\\.\\*\\(B\\)\\[C\\]\\$\\\\')
  })
})
