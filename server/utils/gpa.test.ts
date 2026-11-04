import * as XLSX from 'xlsx'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GpaRecordModel } from '../models/GpaRecord'
import { GpaUploadModel } from '../models/GpaUpload'
import { SubmissionModel } from '../models/Submission'
import { MetadataModel } from '../models/Metadata'
import { commitOptInGpaUpload, importDpscdGpaRecords, normalizeDpscdRecord, parseDpscdBody, parseOptInXlsx, previewOptInGpaUpload } from './gpa'

function optInWorkbook() {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['SCHOOL NAME: Fixture School'],
    ['SubmissionID', 'First Name', 'Last Name', 'Enrolled at least 3 semesters/4 trimesters? (Yes/No)', 'Cumulative Middle School GPA'],
    [101, 'Jamie', 'Rivera', 'YES', 3.75],
    [102, 'Alex', 'Rivera', 'YES', 3.5],
    [999, 'Unknown', 'Applicant', 'YES', 4],
    [103, 'Invalid', 'GPA', 'YES', 9]
  ]), 'GPA')
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

function mockOptInUpload() {
  vi.mocked(GpaUploadModel.findOne).mockResolvedValue({ _id: 'upload-1', cycleId: 'cycle-1', files: [
    { name: 'fixture.xlsx', content: optInWorkbook().toString('base64') }
  ] } as never)
  vi.spyOn(SubmissionModel, 'countDocuments').mockResolvedValue(0)
  vi.spyOn(MetadataModel, 'findOne').mockReturnValue({ select: () => ({ lean: async () => ({ externalId: 'opt-in' }) }) } as never)
  vi.mocked(SubmissionModel.find).mockReturnValue({ select: () => ({ lean: async () => [
    { submissionId: 'sub-1', submissionIdInt: 101, labelIds: ['opt-in'], mappedFields: {} },
    { submissionId: 'sub-2', submissionIdInt: 102, labelIds: [], mappedFields: {} },
    { submissionId: 'sub-3', submissionIdInt: 103, labelIds: ['opt-in'], mappedFields: {} }
  ] }) } as never)
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(GpaUploadModel, 'findOne').mockResolvedValue({ _id: 'upload-1', cycleId: 'cycle-1', records: [
    { 'submissionId': 'sub-1', 'gpa_cumulative': 3.75, 'Quarters Available': 6 },
    { submissionIdInt: 102, gpa_cumulative: 3.5 },
    { STUDENT_NUMBER: 12345, gpa_cumulative: 3.25 },
    { submissionId: 'another-cycle-submission', gpa_cumulative: 4 }
  ] } as never)
  vi.spyOn(SubmissionModel, 'find').mockReturnValue({ select: () => ({ lean: async () => [
    { submissionId: 'sub-1', submissionIdInt: 101, mappedFields: { StudentNumber: '11111' } },
    { submissionId: 'sub-2', submissionIdInt: 102, mappedFields: {} },
    { submissionId: 'sub-3', mappedFields: { StudentNumber: '12345' } }
  ] }) } as never)
  vi.spyOn(GpaRecordModel, 'bulkWrite').mockResolvedValue({ upsertedCount: 3, modifiedCount: 0 } as never)
  vi.spyOn(GpaUploadModel, 'findByIdAndUpdate').mockResolvedValue(null)
})

describe('GPA ingestion', () => {
  it('accepts JSON and legacy Python-style payload values', () => {
    expect(parseDpscdBody('{"cycleId":"cycle-1","records":[{"gpa_cumulative":3.75}]}')).toEqual({ cycleId: 'cycle-1', records: [{ gpa_cumulative: 3.75 }] })
    expect(parseDpscdBody('[{\'gpa_cumulative\': nan, \'missing\': None, \'active\': True, \'flag\': False}]').records).toEqual([{ gpa_cumulative: null, missing: null, active: true, flag: false }])
  })

  it('preserves GPA decimals, normalizes integer fields, and retains source extras', () => {
    expect(normalizeDpscdRecord({ 'STUDENT_NUMBER': '12345.0', 'Quarters Available': '6.0', 'gpa_cumulative': '3.725', 'School': 'Fixture School' })).toMatchObject({ studentNumber: 12345, quartersAvailable: 6, cumulativeGpa: 3.725, extra: { School: 'Fixture School' } })
  })

  it('matches all three identifiers within the selected cycle and preserves the other GPA source', async () => {
    const result = await importDpscdGpaRecords('upload-1', 'job-1', vi.fn())
    expect(result).toMatchObject({ processed: 4, matched: 3, inserted: 3, unmatched: 1 })
    expect(SubmissionModel.find).toHaveBeenCalledWith({ cycleId: 'cycle-1' })
    const operations = vi.mocked(GpaRecordModel.bulkWrite).mock.calls[0]![0] as Array<{ updateOne: { filter: unknown, update: { $set: Record<string, unknown> }, upsert: boolean } }>
    expect(operations.map(operation => operation.updateOne.filter)).toEqual(['sub-1', 'sub-2', 'sub-3'].map(submissionId => ({ cycleId: 'cycle-1', submissionId })))
    for (const operation of operations) {
      expect(operation.updateOne.upsert).toBe(true)
      expect(operation.updateOne.update.$set).not.toHaveProperty('optIn')
      expect(operation.updateOne.update.$set.dpscd).toMatchObject({ importJobId: 'job-1' })
    }
    expect(GpaUploadModel.findByIdAndUpdate).toHaveBeenCalledWith('upload-1', { $set: expect.objectContaining({ status: 'completed', records: [] }) })
  })

  it('reuses upsert keys on repeat imports', async () => {
    await importDpscdGpaRecords('upload-1', 'job-1', vi.fn())
    await importDpscdGpaRecords('upload-1', 'job-2', vi.fn())
    const calls = vi.mocked(GpaRecordModel.bulkWrite).mock.calls
    const filters = (operations: unknown) => (operations as Array<{ updateOne: { filter: unknown } }>).map(operation => operation.updateOne.filter)
    expect(filters(calls[1]![0])).toEqual(filters(calls[0]![0]))
  })

  it('records a failed write without clearing staged source records', async () => {
    vi.mocked(GpaRecordModel.bulkWrite).mockRejectedValueOnce(new Error('write failed'))
    await expect(importDpscdGpaRecords('upload-1', 'job-1', vi.fn())).rejects.toThrow('write failed')
    expect(GpaUploadModel.findByIdAndUpdate).toHaveBeenCalledExactlyOnceWith('upload-1', { $set: { status: 'failed', error: 'write failed' } })
  })

  it('previews Opt-In match warnings and invalid rows without writing GPA records', async () => {
    mockOptInUpload()
    const preview = await previewOptInGpaUpload('upload-1', vi.fn())
    expect(preview).toMatchObject({ processed: 4, matched: 1, missingOptInLabel: 1, unmatched: 1, invalidGpa: 1 })
    expect(GpaRecordModel.bulkWrite).not.toHaveBeenCalled()
  })

  it('commits only matched valid Opt-In rows without replacing DPSCD data', async () => {
    mockOptInUpload()
    const result = await commitOptInGpaUpload('upload-1', vi.fn())
    expect(result).toMatchObject({ processed: 4, skippedUnmatched: 1, skippedInvalid: 1, missingOptInLabel: 1 })
    const operations = vi.mocked(GpaRecordModel.bulkWrite).mock.calls[0]![0] as Array<{ updateOne: { filter: unknown, update: { $set: Record<string, unknown> } } }>
    expect(operations.map(operation => operation.updateOne.filter)).toEqual(['sub-1', 'sub-2'].map(submissionId => ({ cycleId: 'cycle-1', submissionId })))
    for (const operation of operations) {
      expect(operation.updateOne.update.$set).not.toHaveProperty('dpscd')
      expect(operation.updateOne.update.$set.optIn).toMatchObject({ schoolName: 'Fixture School', uploadId: 'upload-1' })
    }
    expect(GpaUploadModel.findByIdAndUpdate).toHaveBeenCalledWith('upload-1', { $set: expect.objectContaining({ status: 'completed', files: [] }) })
  })

  it('parses an Opt-In workbook with its school banner and enrollment flag', () => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['SCHOOL NAME: Fixture School'],
      ['SubmissionID', 'First Name', 'Last Name', 'Enrolled at least 3 semesters/4 trimesters? (Yes/No)', 'Cumulative Middle School GPA'],
      [101, 'Jamie', 'Rivera', 'YES', 3.75]
    ]), 'GPA')
    const file = parseOptInXlsx('fixture.xlsx', XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }))
    expect(file).toMatchObject({ schoolName: 'Fixture School', errors: [], rows: [{ submissionIdInt: 101, firstName: 'Jamie', lastName: 'Rivera', enrolledMinTermsFlag: true, cumulativeGpa: 3.75 }] })
  })
})
