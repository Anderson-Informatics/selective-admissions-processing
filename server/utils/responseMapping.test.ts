import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FieldMappingModel } from '../models/FieldMapping'
import { FormEntryModel } from '../models/FormEntry'
import { MetadataModel } from '../models/Metadata'
import { ReviewModel } from '../models/Review'
import { SubmissionModel } from '../models/Submission'
import { getMappedFormIds } from './mappingStatus'
import { mapFormResponsesForCycle } from './responseMapping'

vi.mock('./mappingStatus', () => ({ getMappedFormIds: vi.fn() }))
const entry = { _id: 'entry-1', submissionId: 'sub-1', formId: 'form-1', fieldData: [
  { formFieldId: 'name', fieldType: 'name', firstName: 'Jamie', lastName: 'Rivera' },
  { formFieldId: 'school', options: ['option-1'] },
  { formFieldId: 'upload', files: [{ fileName: 'transcript.pdf' }] }
] }
const review = { _id: 'review-1', submissionId: 'sub-1', formId: 'form-1', fieldData: [
  { formFieldId: 'name', fieldType: 'name', firstName: 'Reviewer' }
] }
const cursor = (items: unknown[]) => ({ sort: () => ({ allowDiskUse: () => ({ lean: () => ({ cursor: async function* () {
  yield* items
} }) }) }) })

beforeEach(() => {
  vi.restoreAllMocks()
  vi.mocked(getMappedFormIds).mockResolvedValue(['form-1'])
  vi.spyOn(FieldMappingModel, 'find').mockReturnValue({ lean: async () => [
    ['name:firstName', 'FirstName'], ['name:lastName', 'LastName'], ['school', 'FirstChoiceSchool'], ['upload', 'UploadNonDPSCD']
  ].map(([fieldId, canonicalName]) => ({ formId: 'form-1', fieldId, canonicalName })) } as never)
  vi.spyOn(MetadataModel, 'find').mockReturnValue({ sort: () => ({ lean: async () => [{ externalId: 'form-1', data: { fields: [
    { formFieldId: 'school', options: [{ formOptionId: 'option-1', label: 'Fixture School' }] }
  ] } }] }) } as never)
  vi.spyOn(FormEntryModel, 'countDocuments').mockResolvedValue(1)
  vi.spyOn(ReviewModel, 'countDocuments').mockResolvedValue(1)
  vi.spyOn(FormEntryModel, 'find').mockReturnValue(cursor([entry]) as never)
  vi.spyOn(ReviewModel, 'find').mockReturnValue(cursor([review]) as never)
  vi.spyOn(FormEntryModel, 'bulkWrite').mockResolvedValue({} as never)
  vi.spyOn(ReviewModel, 'bulkWrite').mockResolvedValue({} as never)
  vi.spyOn(SubmissionModel, 'bulkWrite').mockResolvedValue({} as never)
})

describe('response mapping', () => {
  it('maps names, option labels, and attachments while keeping review answers separate', async () => {
    await expect(mapFormResponsesForCycle('cycle-1', ['app-1'])).resolves.toEqual({ formEntries: 1, reviews: 1, submissions: 1 })
    const filter = { cycleId: 'cycle-1', formId: { $in: ['form-1'] }, applicationId: { $in: ['app-1'] } }
    expect(FormEntryModel.find).toHaveBeenCalledWith(filter)
    expect(ReviewModel.find).toHaveBeenCalledWith(filter)
    expect(SubmissionModel.bulkWrite).toHaveBeenCalledWith([{ updateOne: {
      filter: { submissionId: 'sub-1' },
      update: { $set: { isMapped: true, mappedFields: { FirstName: 'Jamie', LastName: 'Rivera', FirstChoiceSchool: 'Fixture School', UploadNonDPSCD: 'transcript.pdf' } } }
    } }])
    expect(ReviewModel.bulkWrite).toHaveBeenCalledWith([{ updateOne: { filter: { _id: 'review-1' }, update: { $set: { isMapped: true, mappedData: { FirstName: 'Reviewer' } } } } }])
  })

  it('does not touch entries when the selected applications have no mappings', async () => {
    await expect(mapFormResponsesForCycle('cycle-1', [])).resolves.toEqual({ formEntries: 0, reviews: 0, submissions: 0 })
    expect(FormEntryModel.find).not.toHaveBeenCalled()
    expect(SubmissionModel.bulkWrite).not.toHaveBeenCalled()
  })

  it('produces the same submission update when mapping is rerun', async () => {
    await mapFormResponsesForCycle('cycle-1', ['app-1'])
    await mapFormResponsesForCycle('cycle-1', ['app-1'])
    const calls = vi.mocked(SubmissionModel.bulkWrite).mock.calls
    expect(calls[1]![0]).toEqual(calls[0]![0])
  })

  it('does not mark submissions mapped after an entry write fails', async () => {
    vi.mocked(FormEntryModel.bulkWrite).mockRejectedValueOnce(new Error('write failed'))
    await expect(mapFormResponsesForCycle('cycle-1')).rejects.toThrow('write failed')
    expect(SubmissionModel.bulkWrite).not.toHaveBeenCalled()
  })
})
