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
  mocks.applications.mockReturnValue(chain([{ _id: 'app', name: 'Application', initialFormId: 'initial' }]))
})

describe('loadIepRoster', () => {
  it('queries cycle-scoped eligible records and resolves stage identities from metadata', async () => {
    const result = await loadIepRoster('cycle')
    expect(mocks.submissions).toHaveBeenCalledWith({ cycleId: 'cycle', labelIds: { $in: ['iep', 'mll'] }, status: { $not: /^withdrawn$/i } })
    expect(mocks.reviews).toHaveBeenCalledWith({ cycleId: 'cycle', submissionId: { $in: ['student'] } })
    expect(result.rows[0]).toMatchObject({ completeDocuments: 'Yes', finalGroup: 'Group D' })
    expect(result.generatedAt).toBeTruthy()
    expect(result.diagnostics.some(d => d.includes('ParentPhone'))).toBe(true)
    expect(result.diagnostics.some(d => d.includes('IEP Review: missing'))).toBe(false)
  })

  it('checks mappings per form rather than accepting another form’s same canonical names', async () => {
    mocks.mappings.mockReturnValue(chain(['CompleteIEP', 'Accommodations', 'AccommodationsDescribe'].map(canonicalName => ({ formId: 'other-form', canonicalName }))))
    const result = await loadIepRoster('cycle')
    expect(result.diagnostics.some(d => d.includes('Application / IEP Review: missing mappings CompleteIEP'))).toBe(true)
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
