import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectiveAuthorities, loadSchoolDirectory, schoolKey, schoolSchema } from './schoolDirectory'
import { SchoolModel } from '../models/School'
import { SchoolRepresentativeModel } from '../models/SchoolRepresentative'
import { SchoolAuthorityModel } from '../models/SchoolAuthority'
import { MetadataModel } from '../models/Metadata'
import { decisionConfigSchema, rewriteDecisionStageIds } from './decisionConfig'

afterEach(() => vi.restoreAllMocks())

describe('school directory team member names', () => {
  it('prefers name.full and includes title/email with legacy fallbacks', async () => {
    const empty = { sort: () => ({ lean: async () => [] }) }
    vi.spyOn(SchoolModel, 'find').mockReturnValue(empty as never)
    vi.spyOn(SchoolRepresentativeModel, 'find').mockReturnValue(empty as never)
    vi.spyOn(SchoolAuthorityModel, 'find').mockReturnValue(empty as never)
    const select = vi.fn(() => ({ lean: async () => [
      { externalId: 'u1', name: 'Legacy Name', data: { name: { full: ' Jordan Rivera ' }, title: ' Principal ', email: ' jordan@example.test ' } },
      { externalId: 'u2', name: 'Legacy Name', data: { name: { full: ' ' }, title: null } },
      { externalId: 'u3', name: '', data: {} }
    ] }))
    vi.spyOn(MetadataModel, 'find').mockReturnValue({ select } as never)
    const directory = await loadSchoolDirectory('cycle')
    expect(directory.members[0]).toMatchObject({ userId: 'u1', name: 'Jordan Rivera', title: 'Principal', email: 'jordan@example.test' })
    expect(directory.members[1]).toMatchObject({ userId: 'u2', name: 'Legacy Name' })
    expect(directory.members[1]?.title).toBeUndefined()
    expect(directory.members[2]?.name).toBe('u3')
    expect(select).toHaveBeenCalledWith(expect.stringContaining('data.name.full'))
    expect(select).toHaveBeenCalledWith(expect.stringContaining('data.title'))
  })
})

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
