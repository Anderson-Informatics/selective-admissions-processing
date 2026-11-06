import { describe, expect, it } from 'vitest'
import { buildListOptionLabels, buildMergeFieldSources, mergeFieldToken } from './mergeFields'

const forms = [
  { externalId: 'init', name: 'Application Form', data: { fields: [{ formFieldId: 'f1', label: 'First name?' }] } },
  { externalId: 'essay', name: 'Essay Review Form', data: { fields: [{ formFieldId: 'e1', label: 'Essay score' }] } }
]
const mappings = [
  { formId: 'init', fieldId: 'f1', label: 'First', canonicalName: 'First Name' },
  { formId: 'init', fieldId: 'f2', label: 'Unmapped', canonicalName: '' },
  { formId: 'essay', fieldId: 'e1', label: 'Score', canonicalName: 'Essay Score' },
  { formId: 'essay', fieldId: 'e2', label: 'Comments', canonicalName: 'Essay Comments' }
]

describe('buildMergeFieldSources', () => {
  it('separates submission and review sources with tokens', () => {
    const sources = buildMergeFieldSources({
      applications: [{ initialFormId: 'init' }],
      stages: [{ name: 'Essay Review', formId: 'essay', order: 2 }, { name: 'No Form', order: 1 }],
      mappings,
      forms
    })
    expect(sources.map(source => source.label)).toEqual(['Submission', 'Essay Review Form (Essay Review)'])
    expect(sources[0]!.fields).toEqual([{ value: 'First Name', label: 'First Name', questionText: 'First name?', token: '{{First Name}}' }])
    expect(sources[1]!.fields.map(field => field.token)).toEqual(['{{Essay Review.Essay Comments}}', '{{Essay Review.Essay Score}}'])
  })

  it('merges same-named stages that share a form across applications', () => {
    const sources = buildMergeFieldSources({
      applications: [{ initialFormId: 'init' }, { initialFormId: 'init' }],
      stages: [{ name: 'Essay Review', formId: 'essay', order: 3 }, { name: 'essay review ', formId: 'essay', order: 1 }],
      mappings,
      forms
    })
    expect(sources).toHaveLength(2)
    expect(sources[0]!.fields).toHaveLength(1)
  })

  it('falls back to static fields when nothing is mapped', () => {
    const sources = buildMergeFieldSources({ applications: [], stages: [], mappings: [], forms: [], fallbackFields: ['Last Name'] })
    expect(sources).toEqual([{ key: 'submission', label: 'Submission', kind: 'submission', fields: [{ value: 'Last Name', label: 'Last Name', token: '{{Last Name}}' }] }])
  })

  it('exposes field types and multi-select option labels', () => {
    const typedForms = [{ externalId: 'gpa', name: 'GPA Form', data: { fields: [
      { formFieldId: 'g1', label: 'Issues?', fieldType: 'multiple_response', options: [{ label: 'A' }, { label: 'B; C' }] },
      { formFieldId: 'g2', label: 'Notes', fieldType: 'long_answer' }
    ] } }]
    const typedMappings = [
      { formId: 'gpa', fieldId: 'g1', label: 'Issues', canonicalName: 'Issues' },
      { formId: 'gpa', fieldId: 'g2', label: 'Notes', canonicalName: 'Notes' }
    ]
    const [, review] = buildMergeFieldSources({ applications: [], stages: [{ name: 'GPA Completion', formId: 'gpa' }], mappings: typedMappings, forms: typedForms })
    expect(review!.fields.map(field => field.fieldType)).toEqual(['multiple_response', 'long_answer'])
    expect(buildListOptionLabels(typedMappings, typedForms)).toEqual({ Issues: ['A', 'B; C'] })
  })

  it('formats tokens by source kind', () => {
    expect(mergeFieldToken({ kind: 'submission' }, 'GPA')).toBe('{{GPA}}')
    expect(mergeFieldToken({ kind: 'review', stageName: 'Interview' }, 'Score')).toBe('{{Interview.Score}}')
  })
})
