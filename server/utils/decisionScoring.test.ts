import { describe, expect, it } from 'vitest'
import { resolveSchoolDecisions } from './decisionScoring'
import { decisionConfigSchema } from './decisionConfig'

const config = decisionConfigSchema.parse({ preferenceFields: ['First', 'Second', 'Third'], schoolIds: ['a', 'b', 'c'], sources: [{ stageId: 'decision', kind: 'field', field: 'Decision', accept: ['Accept'], decline: ['Decline'], waitlist: ['Waitlist'] }] })
const schools = ['a', 'b', 'c'].map(id => ({ id, name: id.toUpperCase(), aliases: [], active: true }))
const representatives = ['a', 'b', 'c'].map(id => ({ userId: `user-${id}`, schoolIds: [id], active: true }))
const authorities = schools.map(school => ({ schoolId: school.id, userId: `user-${school.id}` }))
const review = (school: string, decision: string, extra = {}) => ({ applicationId: 'app', stageId: 'decision', entryId: school, reviewerId: `user-${school}`, status: 'completed', completedAt: '2026-01-01', mappedData: { Decision: decision }, ...extra })
const run = (reviews: ReturnType<typeof review>[], extra = {}) => resolveSchoolDecisions({ applicationId: 'app', config, schools, representatives, authorities, mappedFields: { First: 'A', Second: 'B', Third: 'C' }, reviews, ...extra })

describe('school decisions', () => {
  it('proposes third choice and retains both higher waitlists', () => {
    const result = run([review('a', 'Waitlist'), review('b', 'Waitlist'), review('c', 'Accept')])
    expect(result.proposed?.schoolId).toBe('c')
    expect(result.waitlists.map(item => item.schoolId)).toEqual(['a', 'b'])
    expect(result.waitlists.every(item => item.aboveProposal)).toBe(true)
  })
  it('selects highest accepted choice', () => expect(run([review('a', 'Accept'), review('c', 'Accept')]).proposed?.schoolId).toBe('a'))
  it('does not propose a waitlist', () => expect(run([review('a', 'Waitlist')]).proposed).toBeNull())
  it('ignores other reviewers, stages, applications and incomplete reviews', () => {
    expect(run([review('a', 'Accept', { reviewerId: 'other' }), review('b', 'Accept', { applicationId: 'other' }), review('c', 'Accept', { status: 'pending', completedAt: '' }), review('a', 'Accept', { stageId: 'other' })]).proposed).toBeNull()
  })
  it('does not infer reviewer from createdBy and retains unattributed evidence', () => {
    const result = run([review('a', 'Accept', { reviewerId: '', createdBy: 'user-a' }), review('b', 'Accept', { reviewerId: 'unknown' })])
    expect(result.proposed).toBeNull()
    expect(result.unattributedEvidence.map(item => item.entryId)).toEqual(['a', 'b'])
    expect(result.unattributedEvidence.every(item => !item.authoritative)).toBe(true)
  })
  it('uses the latest revision without reviving an earlier acceptance', () => {
    const result = run([review('a', 'Accept'), review('a', 'Unknown', { entryId: 'new', completedAt: '2026-02-01' }), review('c', 'Accept')])
    expect(result.schools[0]?.outcome).toBe('unresolved')
    expect(result.proposed).toBeNull()
    expect(result.candidate?.schoolId).toBe('c')
  })
  it('blocks a proposal when latest authoritative decisions conflict', () => {
    expect(run([review('a', 'Accept'), review('a', 'Decline', { entryId: 'other' }), review('c', 'Accept')]).proposed).toBeNull()
  })
  it('treats whitespace-only choices as blank rather than unknown schools', () => {
    expect(run([review('c', 'Accept')], { mappedFields: { First: '   ', Third: 'C' } }).proposed?.rank).toBe(3)
  })
  it('does not block lower acceptance for a missing higher decision', () => expect(run([review('c', 'Accept')]).proposed?.rank).toBe(3))
  it('diagnoses unknown choices before an acceptance', () => expect(run([review('c', 'Accept')], { mappedFields: { First: 'Unknown', Third: 'C' } }).proposed).toBeNull())
  it('uses earliest duplicate choice and diagnoses it', () => {
    const result = run([review('c', 'Accept')], { mappedFields: { First: 'C', Second: 'C' } })
    expect(result.proposed?.rank).toBe(1)
    expect(result.diagnostics.join(' ')).toContain('Duplicate')
  })
  it('does not count inactive representatives or unranked acceptances', () => {
    expect(run([review('a', 'Accept')], { representatives: [] }).proposed).toBeNull()
    expect(run([review('a', 'Accept')], { mappedFields: { Third: 'C' } }).proposed).toBeNull()
  })
  it('does not apply one ambiguous reviewer decision to two schools', () => {
    const result = run([review('a', 'Accept')], { representatives: [{ userId: 'user-a', schoolIds: ['a', 'b'], active: true }], authorities: [{ schoolId: 'a', userId: 'user-a' }, { schoolId: 'b', userId: 'user-a' }] })
    expect(result.proposed).toBeNull()
    expect(result.diagnostics.join(' ')).toContain('multiple participating schools')
  })
  it('allows equivalent latest ties and uses creation time when completion time is absent', () => {
    expect(run([review('a', 'Accept'), review('a', 'Accept', { entryId: 'duplicate' })]).proposed?.schoolId).toBe('a')
    const result = run([review('a', 'Accept', { completedAt: '', createdAt: '2026-01-02' })])
    expect(result.proposed?.schoolId).toBe('a')
    expect(result.diagnostics.join(' ')).toContain('using creation time')
  })
  it('allows explicitly configured score-based outcomes without field fallback', () => {
    const scoreConfig = decisionConfigSchema.parse({ ...config, sources: [{ stageId: 'decision', kind: 'score', accept: [10], decline: [-5], waitlist: [2] }] })
    expect(run([review('a', 'Decline', { score: 10 })], { config: scoreConfig }).proposed?.schoolId).toBe('a')
    expect(run([review('a', 'Accept')], { config: scoreConfig }).proposed).toBeNull()
  })
  it('excludes withdrawn submissions', () => expect(run([review('a', 'Accept')], { status: 'Withdrawn' }).schools).toEqual([]))
})
