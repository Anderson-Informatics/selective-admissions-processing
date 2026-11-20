import { describe, expect, it } from 'vitest'
import { accommodationGroup, buildIepRoster, splitAccommodationGroups, type IepRosterRow } from './iepRostering'
import { normalizeExamSchedulingConfig, type SchedulableSubmission } from './examScheduling'

const config = normalizeExamSchedulingConfig({ iep504LabelIds: ['iep'], mllLabelId: 'mll' })
const labels = [{ externalId: 'day', name: 'HSPT Nov 21' }, { externalId: 'day2', name: 'HSPT Dec 5' }]
const student = (id: string, extra: Partial<SchedulableSubmission> = {}): SchedulableSubmission => ({ submissionId: id, applicationId: 'app', labelIds: ['day', 'iep'], mappedFields: { FirstName: 'Test', LastName: id, ParentPhone: '0123' }, ...extra })
const row = (id: number, accommodations: string, group = 'Group G'): IepRosterRow => ({ submissionId: String(id).padStart(3, '0'), sessionLabelId: 'day', examDate: 'HSPT Nov 21', firstName: 'Test', lastName: String(id).padStart(3, '0'), fullName: 'Test', type: 'IEP', completeDocuments: '', accommodationsRequired: '', accommodations, otherAccommodations: '', parentPhone: '', language: '', mllSupport: false, accommodationGroup: group, finalGroup: group, notices: [], warnings: [] })

describe('accommodation groups', () => {
  it.each([
    ['Human Scribe; extended time', true, 'Group I'],
    ['human reader', false, 'Group I'],
    ['Text to Speech', false, 'Group A'],
    ['read aloud; Extra Time', false, 'Group B'],
    ['extended time; frequent breaks', false, 'Group C'],
    ['extended time', false, 'Group D'],
    ['small group less than 5', false, 'Group G'],
    ['Other', false, 'Group G'],
    ['No Accommodations Required', false, 'No Accommodations'],
    ['No accommodations are required', false, 'No Accommodations'],
    ['', false, 'No Group Assigned'],
    ['custom support', false, 'Group G'],
    ['extended time', true, 'Group F - spanish']
  ])('classifies %s', (value, mll, expected) => expect(accommodationGroup(value, mll, ' Spanish ', config.noAccommodationsValue)).toBe(expected))

  it.each([[7, 7], [8, 7], [12, 12], [13, 12], [35, 7]])('splits %i students without exceeding %i', (count, cap) => {
    const input = Array.from({ length: count }, (_, i) => row(i, i < 3 ? `small group less than ${cap === 7 ? 5 : 10}` : 'small group'))
    const result = splitAccommodationGroups(input)
    expect(splitAccommodationGroups([...input].reverse())).toEqual(result)
    expect(new Set(result.map(r => r.submissionId)).size).toBe(count)
    for (const group of new Set(result.map(r => r.finalGroup))) expect(result.filter(r => r.finalGroup === group).length).toBeLessThanOrEqual(cap)
    if (count > cap && cap === 7) expect(new Set(result.slice(0, 3).map(r => r.finalGroup)).size).toBe(1)
  })

  it('balances many constrained students and isolates day/language groups', () => {
    const input = Array.from({ length: 30 }, (_, i) => row(i, 'small group less than 5', i < 15 ? 'Group F - spanish' : 'Group F - arabic'))
    const result = splitAccommodationGroups(input)
    expect(new Set(result.map(r => r.finalGroup)).size).toBe(6)
    for (const group of new Set(result.map(r => r.finalGroup))) expect(result.filter(r => r.finalGroup === group)).toHaveLength(5)
    expect(splitAccommodationGroups([row(1, '', 'Group G'), { ...row(2, '', 'Group G'), sessionLabelId: 'day2' }]).map(r => r.finalGroup)).toEqual(['Group G', 'Group G'])
  })
})

describe('roster extraction', () => {
  it('includes incomplete/no-accommodation students, dedupes per day, excludes withdrawn, reports missing days', () => {
    const a = student('a', { labelIds: ['day', 'day2', 'iep'] })
    const result = buildIepRoster({ config, labels, stages: [], submissions: [a, a, student('b'), student('w', { status: 'Withdrawn' }), student('no-day', { labelIds: ['iep'] }), student('general', { labelIds: ['day'] })], reviewsBySubmission: new Map([['a', [{ stageName: 'IEP Review', status: 'completed', mappedData: { CompleteIEP: 'Yes', Accommodations: 'No Accommodations Required' } }]]]) })
    expect(result.rows).toHaveLength(3)
    expect(result.rows.filter(r => r.submissionId === 'a')).toHaveLength(2)
    expect(result.rows[0]).toMatchObject({ completeDocuments: 'Yes', accommodationsRequired: 'No', finalGroup: 'No Accommodations' })
    expect(result.rows.find(r => r.submissionId === 'b')?.notices).toContain('Completion Review Incomplete')
    expect(result.diagnostics[0]).toContain('1 IEP/504/MLL')
  })

  it('uses reviewed language and retains both IEP and MLL support without draft or foreign answers', () => {
    const result = buildIepRoster({ config, labels, stages: [], submissions: [student('a', { labelIds: ['day', 'iep', 'mll'], mappedFields: { Language: 'Initial language', IEPor504: 'IEP' } })], reviewsBySubmission: new Map([['a', [
      { applicationId: 'app', stageName: 'IEP Review', status: 'complete', mappedData: { CompleteIEP: 'Yes', Accommodations: 'extended time', AccommodationsDescribe: 'Keep details' } },
      { applicationId: 'app', stageName: 'MLL Review', status: 'complete', mappedData: { MLLAccommodations: 'Yes', Language: 'Spanish' } },
      { applicationId: 'app', stageName: 'MLL Review', status: 'draft', mappedData: { Language: 'Draft' } },
      { applicationId: 'other', stageName: 'MLL Review', status: 'complete', mappedData: { Language: 'Foreign' } }
    ]]]) })
    expect(result.rows[0]).toMatchObject({ finalGroup: 'Group F - spanish', accommodations: 'extended time; Spanish Support', otherAccommodations: 'Keep details', completeDocuments: 'Yes' })
    expect(result.rows[0]!.notices).toContain('MLL Language: Spanish')
    expect(result.rows[0]!.warnings.join()).toContain('Overlapping')
  })

  it('reports a missing required Completion form even with an actual review, and retains MLL No as known', () => {
    const result = buildIepRoster({ config, labels, stages: [], submissions: [
      student('iep', { reviewCompletion: [{ name: 'IEP/ 504 Completion', required: true, complete: true }] }),
      student('mll', { labelIds: ['day', 'mll'] })
    ], reviewsBySubmission: new Map([
      ['iep', [{ stageName: 'IEP Review', status: 'complete', mappedData: { CompleteIEP: 'No', Accommodations: 'extended time' } }]],
      ['mll', [{ stageName: 'MLL Review', status: 'complete', mappedData: { MLLAccommodations: 'No' } }]]
    ]) })
    expect(result.rows.find(row => row.submissionId === 'iep')!.notices).toEqual(['Incomplete IEP/504 Submitted', 'Completion Review Incomplete'])
    expect(result.rows.find(row => row.submissionId === 'mll')).toMatchObject({ accommodationsRequired: 'No', finalGroup: 'No Accommodations' })
  })

  it('keeps unknown language distinct and document incompleteness separate from form completion', () => {
    const result = buildIepRoster({ config, labels, stages: [], submissions: [student('a', { labelIds: ['day', 'mll', 'iep'] })], reviewsBySubmission: new Map([['a', [
      { stageName: 'IEP/ 504 Completion', status: 'complete', mappedData: { CompleteIEP504: 'No' } },
      { stageName: 'MLL Review', status: 'complete', mappedData: { MLLAccommodations: 'Yes' } }
    ]]]) })
    expect(result.rows[0]).toMatchObject({ completeDocuments: 'No', finalGroup: 'Group F - unknown language' })
    expect(result.rows[0]!.notices).toContain('Incomplete IEP/504 Submitted')
    expect(result.rows[0]!.notices).not.toContain('Completion Review Incomplete')
  })
})
