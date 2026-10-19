import { describe, expect, it } from 'vitest'
import { moveSibling } from './reorderConditions'

describe('routing condition reordering', () => {
  const first = { kind: 'field', name: 'A' }
  const nested = { operator: 'or', conditions: [{ kind: 'field', name: 'B' }, { kind: 'field', name: 'C' }] }
  const last = { kind: 'label', labelId: 'label-1' }

  it('moves a whole nested group among its siblings without changing its children', () => {
    const items = [first, nested, last]
    const moved = moveSibling(items, 1, 1)
    expect(moved).toEqual([first, last, nested])
    expect(moved[2]).toBe(nested)
    expect(nested.conditions).toEqual([{ kind: 'field', name: 'B' }, { kind: 'field', name: 'C' }])
    expect(items).toEqual([first, nested, last])
  })

  it('moves conditions up and ignores out-of-bounds moves', () => {
    const items = [first, nested, last]
    expect(moveSibling(items, 2, -1)).toEqual([first, last, nested])
    expect(moveSibling(items, 0, -1)).toBe(items)
    expect(moveSibling(items, items.length - 1, 1)).toBe(items)
  })
})
