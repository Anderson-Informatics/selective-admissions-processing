import { describe, expect, it } from 'vitest'
import { changeOperator, conditionValueList, newCondition, numericValueList } from './conditionValues'

describe('condition values', () => {
  it('starts specialized conditions with operands the evaluator reads', () => {
    expect(newCondition('hsptLinked')).toMatchObject({ exists: true })
    expect(newCondition('gpaRecord')).toMatchObject({ source: 'any', exists: true })
    expect(newCondition('label')).toMatchObject({ op: 'hasLabel', labelId: '' })
  })

  it('edits IN values as discrete entries without splitting embedded commas', () => {
    const condition = changeOperator({ kind: 'field', op: 'eq', value: 'Detroit, MI' }, 'in')
    expect(conditionValueList(condition)).toEqual(['Detroit, MI'])
    expect(numericValueList(condition, [' Detroit, MI ', 'Yes'])).toEqual(['Detroit, MI', 'Yes'])
    expect(changeOperator(condition, 'eq').value).toBe('Detroit, MI')
  })

  it('preserves existing numeric array entries when editing tags', () => {
    expect(numericValueList({ kind: 'field', value: [2, 3] }, ['2', '3', '4'])).toEqual([2, 3, '4'])
    expect(numericValueList({ kind: 'reviewCount', value: [2] }, ['2', '3'])).toEqual([2, 3])
    expect(changeOperator({ kind: 'reviewField', op: 'eq', value: '4.3' }, 'gte').value).toBe(4.3)
  })
})
