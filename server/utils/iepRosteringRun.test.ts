import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadIepRoster } from './iepRosteringRun'

const mocks = vi.hoisted(() => ({ cycle: vi.fn(), labels: vi.fn(), submissions: vi.fn(), reviews: vi.fn(), stages: vi.fn(), mappings: vi.fn(), applications: vi.fn() }))
vi.mock('../models/Cycle', () => ({ CycleModel: { findById: mocks.cycle } }))
vi.mock('../models/Metadata', () => ({ MetadataModel: { find: mocks.labels } }))
vi.mock('../models/Submission', () => ({ SubmissionModel: { find: mocks.submissions } }))
vi.mock('../models/Review', () => ({ ReviewModel: { find: mocks.reviews } }))
vi.mock('../models/ReviewStage', () => ({ ReviewStageModel: { find: mocks.stages } }))
vi.mock('../models/FieldMapping', () => ({ FieldMappingModel: { find: mocks.mappings } }))
vi.mock('../models/Application', () => ({ ApplicationModel: { find: mocks.applications } }))

const chain = (value: unknown) => ({ select: vi.fn().mockReturnValue({ lean: async () => value }) })
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('createError', (error: unknown) => error)
  mocks.cycle.mockReturnValue(chain({ examScheduling: { iep504LabelIds: ['iep'], mllLabelId: 'mll' } }))
  mocks.labels.mockReturnValue(chain([{ externalId: 'iep', name: 'IEP' }, { externalId: 'mll', name: 'MLL' }, { externalId: 'day', name: 'HSPT Nov 21' }]))
  mocks.submissions.mockReturnValue(chain([{ submissionId: 'student', submissionIdInt: 123, applicationId: 'app', labelIds: ['day', 'iep'], mappedFields: { FirstName: 'Test', LastName: 'Student' } }]))
  mocks.reviews.mockReturnValue(chain([{ submissionId: 'student', applicationId: 'app', stageId: 'iep-review', status: 'complete', mappedData: { CompleteIEP: 'Yes', Accommodations: 'Extended time' } }]))
  mocks.stages.mockReturnValue(chain([{ applicationId: 'app', stageId: 'iep-review', name: 'IEP Review', formId: 'iep-form' }]))
  mocks.mappings.mockReturnValue(chain(['CompleteIEP', 'Accommodations', 'AccommodationsDescribe'].map(canonicalName => ({ formId: 'iep-form', canonicalName }))))
  mocks.applications.mockReturnValue(chain([{ _id: 'app', name: '9th Grade', initialFormId: 'initial' }]))
})

describe('loadIepRoster', () => {
  it('queries cycle-scoped eligible records and resolves stage identities from metadata', async () => {
    const result = await loadIepRoster('cycle')
    expect(mocks.submissions).toHaveBeenCalledWith({ cycleId: 'cycle', applicationId: { $in: ['app'] }, labelIds: { $in: ['iep', 'mll'] }, status: { $not: /^withdrawn$/i } })
    expect(mocks.reviews).toHaveBeenCalledWith({ cycleId: 'cycle', submissionId: { $in: ['student'] } })
    expect(result.rows[0]).toMatchObject({ completeDocuments: 'Yes', finalGroup: 'Group D' })
    expect(result.generatedAt).toBeTruthy()
    expect(result.diagnostics.some(d => d.includes('ParentPhone'))).toBe(true)
    expect(result.diagnostics.some(d => d.includes('IEP Review: missing'))).toBe(false)
  })

  it('checks mappings per form rather than accepting another form’s same canonical names', async () => {
    mocks.mappings.mockReturnValue(chain(['CompleteIEP', 'Accommodations', 'AccommodationsDescribe'].map(canonicalName => ({ formId: 'other-form', canonicalName }))))
    const result = await loadIepRoster('cycle')
    expect(result.diagnostics.some(d => d.includes('9th Grade / IEP Review: missing mappings CompleteIEP'))).toBe(true)
  })

  it('scopes submission and stage queries to only the two named applications', async () => {
    mocks.applications.mockReturnValue(chain([
      { _id: 'app', name: '9th Grade' }, { _id: 'hs', name: ' Current HS ' },
      { _id: 'other', name: 'Other Application' }, { _id: 'similar', name: '9th Grade Other' }
    ]))
    const result = await loadIepRoster('cycle')
    expect(mocks.submissions).toHaveBeenCalledWith(expect.objectContaining({ applicationId: { $in: ['app', 'hs'] } }))
    expect(mocks.stages).toHaveBeenCalledWith({ cycleId: 'cycle', applicationId: { $in: ['app', 'hs'] } })
    expect(result.diagnostics.join()).not.toContain('Other Application')
  })

  it.each([2027, 2028])('recognizes the full application titles for %i within the selected cycle', async (year) => {
    mocks.applications.mockReturnValue(chain([
      { _id: 'app', name: `9th Grade Exam HS Application - Fall ${year}` },
      { _id: 'hs', name: `Exam High School Application for Current High School Students ${year}` },
      { _id: 'other', name: `Other Application ${year}` },
      { _id: 'similar', name: `9th Grade Exam HS Application - Fall ${year} Other` }
    ]))
    const result = await loadIepRoster(`cycle-${year}`)
    expect(mocks.applications).toHaveBeenCalledWith({ cycleId: `cycle-${year}` })
    expect(mocks.submissions).toHaveBeenCalledWith(expect.objectContaining({ cycleId: `cycle-${year}`, applicationId: { $in: ['app', 'hs'] } }))
    expect(mocks.stages).toHaveBeenCalledWith({ cycleId: `cycle-${year}`, applicationId: { $in: ['app', 'hs'] } })
    expect(result.rows).toHaveLength(1)
    expect(result.diagnostics.join()).not.toContain('Other Application')
  })

  it('normalizes case and whitespace and allows titles without a year', async () => {
    mocks.applications.mockReturnValue(chain([
      { _id: 'app', name: ' 9TH  Grade Exam HS Application - Fall ' },
      { _id: 'hs', name: ' Exam High School Application FOR Current High School Students ' }
    ]))
    await loadIepRoster('cycle')
    expect(mocks.submissions).toHaveBeenCalledWith(expect.objectContaining({ applicationId: { $in: ['app', 'hs'] } }))
  })

  it('returns an explanatory empty roster when neither application exists', async () => {
    mocks.applications.mockReturnValue(chain([{ _id: 'other', name: 'Other' }]))
    const result = await loadIepRoster('cycle')
    expect(result).toMatchObject({ rows: [], sessions: [] })
    expect(result.diagnostics.join()).toContain('9th Grade or Current HS')
    expect(mocks.submissions).not.toHaveBeenCalled()
    expect(mocks.reviews).not.toHaveBeenCalled()
  })

  it('fails clearly for missing cycles, missing labels and invalid day patterns', async () => {
    mocks.cycle.mockReturnValueOnce(chain(null))
    await expect(loadIepRoster('missing')).rejects.toMatchObject({ statusCode: 404 })
    mocks.cycle.mockReturnValueOnce(chain({ examScheduling: {} }))
    await expect(loadIepRoster('cycle')).rejects.toMatchObject({ statusCode: 409 })
    mocks.cycle.mockReturnValueOnce(chain({ examScheduling: { iep504LabelIds: ['iep'], mllLabelId: 'mll', sessionLabelPattern: '[' } }))
    await expect(loadIepRoster('cycle')).rejects.toMatchObject({ statusCode: 409 })
    expect(mocks.submissions).not.toHaveBeenCalled()
  })
})
