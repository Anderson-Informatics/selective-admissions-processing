import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnyBulkWriteOperation } from 'mongoose'
import { SubmissionModel, type Submission } from '../models/Submission'
import { ValidationIssueModel, type ValidationIssue } from '../models/ValidationIssue'
import { runValidationForCycle } from './validation'

type Issue = ValidationIssue & { createdAt: Date, updatedAt: Date }
type Input = Pick<Submission, 'submissionId' | 'mappedFields' | 'status' | 'geocode' | 'currentStageId'> & { applicationId: string }

const reference = new Date('2026-10-15T12:00:00Z')
let submissions: Input[]
let issues: Issue[]

function submission(mappedFields: Record<string, unknown> = {}, overrides: Partial<Input> = {}): Input {
  return {
    submissionId: 'sub-1',
    applicationId: 'app-1',
    status: 'complete',
    mappedFields: { DOB: '2012-10-15', ...mappedFields },
    ...overrides
  }
}

function openIssues(type?: string): Issue[] {
  return issues.filter(issue => issue.status === 'open' && (!type || issue.type === type))
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(reference)
  submissions = []
  issues = []
  vi.spyOn(SubmissionModel, 'find').mockImplementation(() => ({
    select: () => ({ lean: async () => submissions })
  }) as never)
  vi.spyOn(ValidationIssueModel, 'find').mockImplementation(() => ({
    select: () => ({ lean: async () => issues.filter(issue => issue.status === 'resolved' && issue.resolution === 'override') })
  }) as never)
  vi.spyOn(ValidationIssueModel, 'bulkWrite').mockImplementation((async (operations: AnyBulkWriteOperation<ValidationIssue>[]) => {
    let upsertedCount = 0
    let modifiedCount = 0
    for (const operation of operations) {
      if (!('updateOne' in operation)) continue
      const { filter, update } = operation.updateOne
      if (!filter || !update || !('$set' in update)) continue
      const key = filter as Pick<Issue, 'cycleId' | 'submissionId' | 'type' | 'field'>
      let issue = issues.find(i => i.cycleId === key.cycleId && i.submissionId === key.submissionId && i.type === key.type && i.field === key.field)
      if (!issue) {
        issue = { ...key, message: '', severity: 'warning', status: 'open', createdAt: reference, updatedAt: reference }
        issues.push(issue)
        upsertedCount++
      } else {
        modifiedCount++
      }
      Object.assign(issue, update.$set)
      delete issue.resolution
      delete issue.resolvedAt
      delete issue.resolvedBy
    }
    return { upsertedCount, modifiedCount }
  }) as never)
  vi.spyOn(ValidationIssueModel, 'updateMany').mockImplementation((async (
    filter: { cycleId: string, updatedAt: { $lt: Date } },
    update: { $set: Partial<Issue> }
  ) => {
    let modifiedCount = 0
    for (const issue of issues) {
      if (issue.cycleId !== filter.cycleId || issue.status !== 'open' || !(issue.updatedAt < filter.updatedAt.$lt)) continue
      Object.assign(issue, update.$set)
      delete issue.resolvedBy
      modifiedCount++
    }
    return { modifiedCount }
  }) as never)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('DOB validation', () => {
  it.each(['2025-02-29', '2024-13-01', '02/30/2024', '2024-01-01extra', '01/02/20', 'garbage'])('rejects invalid or ambiguous date %s', async (dob) => {
    submissions = [submission({ DOB: dob })]
    await runValidationForCycle('cycle-1')
    expect(openIssues('dob_out_of_range')).toMatchObject([{ severity: 'error', message: expect.stringContaining('not a valid date') }])
  })

  it.each(['2016-02-29', '02/29/2016', '2012-10-15T00:00:00.000Z', '2012-10-15T00:00:00'])('accepts valid date %s', async (dob) => {
    submissions = [submission({ DOB: dob })]
    await runValidationForCycle('cycle-1')
    expect(openIssues('dob_out_of_range')).toEqual([])
  })

  it.each(['2021-10-15', '2005-10-15'])('accepts the age boundary for %s', async (dob) => {
    submissions = [submission({ DOB: dob })]
    await runValidationForCycle('cycle-1')
    expect(openIssues('dob_out_of_range')).toEqual([])
  })

  it.each([
    [{ DOB: '' }, 'missing', 'error'],
    [{ DOB: '2027-10-15' }, 'future', 'error'],
    [{ DOB: '2022-10-15' }, '5-21', 'warning'],
    [{ DOB: '2004-10-15' }, '5-21', 'warning'],
    [{ DOB: '2012-10-15', GradeEntering: '12' }, 'grade 12', 'warning']
  ])('checks DOB %j', async (fields, text, severity) => {
    submissions = [submission(fields)]
    await runValidationForCycle('cycle-1')
    expect(openIssues('dob_out_of_range')).toMatchObject([{ severity, message: expect.stringContaining(text) }])
  })
})

describe('DPSCD student ID validation', () => {
  it.each(['12345', '01234', '12345678', '00001234'])('accepts %s', async (id) => {
    submissions = [submission({ DPSCD: 'Yes', StudentNumber: id })]
    await runValidationForCycle('cycle-1')
    expect(openIssues().filter(i => i.type.startsWith('student_number'))).toEqual([])
  })

  it.each([
    ['', 'student_number_invalid', 'missing'],
    ['12A45', 'student_number_invalid', 'only digits'],
    ['1234567', 'student_number_length', '5 or 8'],
    ['1234', 'student_number_length', '5 or 8']
  ])('flags %s as %s', async (id, type, text) => {
    submissions = [submission({ DPSCD: 'yes', StudentNumber: id })]
    await runValidationForCycle('cycle-1')
    expect(openIssues(type)).toMatchObject([{ message: expect.stringContaining(text) }])
  })

  it('does not require an ID for a non-DPSCD applicant', async () => {
    submissions = [submission({ DPSCD: 'No', StudentNumber: 'bad' })]
    await runValidationForCycle('cycle-1')
    expect(openIssues().filter(i => i.type.startsWith('student_number'))).toEqual([])
  })
})

describe('student full-name validation', () => {
  it.each([
    { FullName: 'MAYA LEE SMITH', FirstName: 'Maya', LastName: 'Smith', ParentFirstName: 'Maya', ParentLastName: 'Smith' },
    { FullName: 'Ann-Marie O’Neil', FirstName: 'Ann Marie', LastName: 'O Neil' },
    { FullName: 'D Angelo Smith', FirstName: 'D\'Angelo', LastName: 'Smith' },
    { FullName: 'D’Angelo ONeil', FirstName: 'DAngelo', LastName: 'O\'Neil' },
    { FullName: 'AnneMarie ONeil', FirstName: 'Anne-Marie', LastName: 'O Neil' }
  ])('does not flag a consistent student name', async (fields) => {
    submissions = [submission(fields)]
    await runValidationForCycle('cycle-1')
    expect(openIssues('parent_student_name_swap')).toEqual([])
  })

  it('flags inconsistent names without parent evidence', async () => {
    submissions = [submission({ FullName: 'Joanna Smith', FirstName: 'Ann', LastName: 'Smith' })]
    await runValidationForCycle('cycle-1')
    expect(openIssues('parent_student_name_swap')).toMatchObject([{
      field: 'FullName',
      message: 'Full name does not contain the student first and last names'
    }])
  })

  it.each([
    { FullName: 'Alex Smith', FirstName: 'Alex', LastName: 'Smith Jr.' },
    { FullName: 'Alex Smith', FirstName: 'Alex', LastName: 'Smith III' },
    { FullName: 'Alex Smith Jr.', FirstName: 'Alex', LastName: 'Smith III' },
    { FullName: 'Alex Smith', FirstName: 'Alex', LastName: 'Smith Sr., IV' },
    { FullName: 'Alex Smith', FirstName: 'Alex Jr', LastName: 'Smith' }
  ])('ignores a trailing suffix in only one name field: %j', async (fields) => {
    submissions = [submission(fields)]
    await runValidationForCycle('cycle-1')
    expect(openIssues('parent_student_name_swap')).toEqual([])
  })

  it('does not strip a genuine student surname or mask a genuine mismatch', async () => {
    submissions = [
      submission({ FullName: 'Alex Smith', FirstName: 'Alex', LastName: 'Junior' }),
      submission({ FullName: 'Alex Smith', FirstName: 'Alex', LastName: 'Jones Jr.' }, { submissionId: 'sub-2' })
    ]
    await runValidationForCycle('cycle-1')
    expect(openIssues('parent_student_name_swap')).toHaveLength(2)
  })

  it('keeps a suffix-shaped surname when it is the mapped last name', async () => {
    submissions = [submission({ FullName: 'Alex V', FirstName: 'Alex', LastName: 'V' })]
    await runValidationForCycle('cycle-1')
    expect(openIssues('parent_student_name_swap')).toEqual([])
  })

  it('does not count the same full-name token twice', async () => {
    submissions = [submission({ FullName: 'Lee', FirstName: 'Lee', LastName: 'Lee' })]
    await runValidationForCycle('cycle-1')
    expect(openIssues('parent_student_name_swap')).toHaveLength(1)
  })

  it('auto-resolves an existing punctuation-only name issue on rerun', async () => {
    submissions = [submission({ FullName: 'D’Angelo ONeil', FirstName: 'DAngelo', LastName: 'O\'Neil' })]
    issues = [{
      cycleId: 'cycle-1', applicationId: 'app-1', submissionId: 'sub-1', type: 'parent_student_name_swap',
      field: 'FullName', severity: 'warning', message: 'Full name does not contain the student first and last names',
      status: 'open', createdAt: new Date('2026-10-14'), updatedAt: new Date('2026-10-14')
    }]
    await runValidationForCycle('cycle-1')
    expect(openIssues('parent_student_name_swap')).toEqual([])
    expect(issues[0]).toMatchObject({ status: 'resolved', resolution: 'auto' })
  })

  it.each(['Parent', 'Guardian'])('identifies a probable %s name inserted in FullName', async (relation) => {
    submissions = [submission({
      FullName: 'Jamie Lewis',
      FirstName: 'Alex',
      LastName: 'Lewis',
      [`${relation}FirstName`]: 'Jamie',
      [`${relation}LastName`]: 'Lewis'
    })]
    await runValidationForCycle('cycle-1')
    expect(openIssues('parent_student_name_swap')[0]?.message).toContain('parent or guardian name')
  })

  it('skips missing name mappings rather than guessing', async () => {
    submissions = [submission({ FirstName: 'Alex', LastName: 'Smith' })]
    await runValidationForCycle('cycle-1')
    expect(openIssues('parent_student_name_swap')).toEqual([])
  })
})

describe('issue reconciliation', () => {
  it('keeps duplicates, documents, and geocoding issues, but never creates a review-stage issue', async () => {
    submissions = [
      submission({ FullName: 'Alex Smith', IEPor504: 'yes' }),
      submission({ FullName: 'Alex Smith' }, { submissionId: 'sub-2', geocode: { status: 'failed' }, currentStageId: 'undefined' })
    ]
    await runValidationForCycle('cycle-1')
    expect(openIssues('duplicate_applicant')).toHaveLength(2)
    expect(openIssues('missing_required_documents')).toHaveLength(1)
    expect(openIssues('geocoding_failed')).toHaveLength(1)
    expect(openIssues('incomplete_review_stage')).toEqual([])
  })

  it('auto-resolves fixed and retired issues on a later run without deleting history', async () => {
    submissions = [submission({ DPSCD: 'yes', StudentNumber: '1234567' })]
    issues = [{
      cycleId: 'cycle-1', applicationId: 'app-1', submissionId: 'sub-1', type: 'incomplete_review_stage',
      field: 'currentStageName', severity: 'warning', message: 'stage incomplete', status: 'open',
      createdAt: new Date('2026-10-14'), updatedAt: new Date('2026-10-14')
    }]
    await runValidationForCycle('cycle-1')
    expect(openIssues('student_number_length')).toHaveLength(1)
    expect(issues.find(i => i.type === 'incomplete_review_stage')).toMatchObject({ status: 'resolved', resolution: 'auto' })
    vi.setSystemTime(new Date('2026-10-16T12:00:00Z'))
    submissions = [submission({ DPSCD: 'yes', StudentNumber: '01234' })]
    await runValidationForCycle('cycle-1')
    expect(openIssues('student_number_length')).toEqual([])
    expect(issues.find(i => i.type === 'student_number_length')).toMatchObject({ status: 'resolved', resolution: 'auto' })
  })

  it('preserves manual overrides including legacy name-issue overrides', async () => {
    submissions = [submission({ FullName: 'Jamie Lewis', FirstName: 'Alex', LastName: 'Lewis' })]
    issues = [{
      cycleId: 'cycle-1', applicationId: 'app-1', submissionId: 'sub-1', type: 'parent_student_name_swap',
      field: 'FirstName', severity: 'warning', message: 'previous warning', status: 'resolved', resolution: 'override',
      createdAt: new Date('2026-10-14'), updatedAt: new Date('2026-10-14')
    }]
    await runValidationForCycle('cycle-1')
    expect(openIssues('parent_student_name_swap')).toEqual([])
    expect(issues[0]).toMatchObject({ resolution: 'override', status: 'resolved' })
  })

  it('excludes withdrawn submissions and resolves their previously open issues', async () => {
    submissions = [submission({ DOB: '' }, { status: 'withdrawn' })]
    issues = [{
      cycleId: 'cycle-1', applicationId: 'app-1', submissionId: 'sub-1', type: 'dob_out_of_range',
      field: 'DOB', severity: 'error', message: 'Date of birth is missing', status: 'open',
      createdAt: new Date('2026-10-14'), updatedAt: new Date('2026-10-14')
    }]
    expect(await runValidationForCycle('cycle-1')).toMatchObject({ total: 0, resolved: 1 })
    expect(openIssues()).toEqual([])
  })
})
