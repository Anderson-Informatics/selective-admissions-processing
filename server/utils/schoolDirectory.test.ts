import { describe, expect, it } from 'vitest'
import { effectiveAuthorities, schoolKey, schoolSchema } from './schoolDirectory'
import { decisionConfigSchema, rewriteDecisionStageIds } from './decisionConfig'

const authority = (cycleId: string, applicationId: string, userId: string) => ({ cycleId, applicationId, schoolId: 'school', userId, version: 1 })
describe('school directory configuration', () => {
  it('normalizes names without fuzzy matching', () => {
    expect(schoolKey('  School   A  ')).toBe('school a')
    expect(schoolKey('School-A')).not.toBe(schoolKey('School A'))
    expect(schoolSchema.safeParse({ name: ' ' }).success).toBe(false)
  })
  it('uses application override with no cross-cycle or cross-application leakage', () => {
    const result = effectiveAuthorities([authority('cycle', '', 'default'), authority('cycle', 'app', 'override'), authority('other', 'app', 'wrong-cycle'), authority('cycle', 'other', 'wrong-app')], 'cycle', 'app')
    expect(result.map(item => item.userId)).toEqual(['override'])
  })
  it('rejects ambiguous outcome mappings and duplicate preference fields', () => {
    const config = { preferenceFields: ['First'], schoolIds: ['school'], sources: [{ stageId: 'decision', kind: 'field', field: 'Decision', accept: ['Yes'], decline: [' yes '], waitlist: [] }] }
    expect(decisionConfigSchema.safeParse(config).success).toBe(false)
    expect(decisionConfigSchema.safeParse({ ...config, preferenceFields: ['First', 'First'] }).success).toBe(false)
  })
  it('requires numeric mappings for score sources', () => {
    expect(decisionConfigSchema.safeParse({ preferenceFields: ['First'], schoolIds: ['school'], sources: [{ stageId: 'decision', kind: 'score', accept: ['10'] }] }).success).toBe(false)
  })
  it('rewrites only unambiguous supplied decision-stage mappings', () => {
    const config = decisionConfigSchema.parse({ preferenceFields: ['First'], schoolIds: ['school'], sources: [{ stageId: 'old', kind: 'score', accept: [10] }] })
    expect(rewriteDecisionStageIds(config, new Map([['old', 'new']])).sources[0]?.stageId).toBe('new')
    expect(config.sources[0]?.stageId).toBe('old')
  })
})
