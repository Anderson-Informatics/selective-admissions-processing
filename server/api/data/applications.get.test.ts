import { text } from 'node:stream/consumers'
import type { Readable } from 'node:stream'
import { parse } from 'csv-parse/sync'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { FormEntryModel } from '../../models/FormEntry'
import { SubmissionModel } from '../../models/Submission'

vi.mock('../../models/FormEntry', () => ({
  FormEntryModel: {
    find: vi.fn()
  }
}))

vi.mock('../../models/Submission', () => ({
  SubmissionModel: {
    find: vi.fn(),
    countDocuments: vi.fn()
  }
}))

const expectedColumns = [
  'formType', 'submissionId', 'projectId', 'entryId', 'formId', 'status', 'completedAt', 'createdBy', 'createdAt',
  'entryVersionId', 'openedForEditingAt', 'FullName', 'FirstName', 'LastName', 'SingleAcceptance', 'GradeEntering',
  'ParentFirstName', 'ParentLastName', 'ParentEmail', 'ParentPhone', 'ParentPhone2', 'DOB', 'Email', 'Phone',
  'Address1', 'Address2', 'City', 'State', 'Zip', 'Country', 'Gender', 'DPSCD', 'IEPorNPSPor504', 'ELL', 'ExamDate',
  'Ref1Name', 'Ref1Phone', 'Ref1Email', 'Ref1Relationship', 'Ref2Name', 'Ref2Phone', 'Ref2Email', 'Ref2Relationship',
  'Ref3Name', 'Ref3Phone', 'Ref3Email', 'Ref3Relationship', 'Interests', 'SignatureStudent', 'SignatureParent',
  'SEMCOG', 'OODSchool', 'FirstChoiceSchool', 'SecondChoiceSchool', 'ThirdChoiceSchool', 'Essay', 'Sports',
  'ELLStatement', 'Language', 'DPSCDSchool', 'AnotherSchoolAttend', 'StudentNumber', 'AnotherSchool',
  'UploadNonDPSCD', 'Upload504', 'OtherSchoolLocation', 'UploadIEP', 'FourthChoiceSchool', 'FifthChoiceSchool'
]

let handler: (event: unknown) => Promise<unknown>
const connectDb = vi.fn(async () => {})

function mockEntries(entries: unknown[]) {
  const query = {
    select: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue(entries)
  }
  vi.mocked(FormEntryModel.find).mockReturnValue(query as never)
  return query
}

function mockPage(submissions: unknown[], total = submissions.length) {
  const query = {
    select: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue(submissions)
  }
  vi.mocked(SubmissionModel.find).mockReturnValue(query as never)
  vi.mocked(SubmissionModel.countDocuments).mockResolvedValue(total)
  return query
}

function mockCursor(submissions: unknown[]) {
  const cursor = {
    async* [Symbol.asyncIterator]() { yield* submissions },
    close: vi.fn()
  }
  const query = {
    select: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    lean: vi.fn().mockReturnThis(),
    cursor: vi.fn().mockReturnValue(cursor),
    skip: vi.fn(),
    limit: vi.fn()
  }
  vi.mocked(SubmissionModel.find).mockReturnValue(query as never)
  return { cursor, query }
}

beforeAll(async () => {
  vi.stubGlobal('defineEventHandler', (fn: typeof handler) => fn)
  handler = (await import('./applications.get')).default as typeof handler
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('useRuntimeConfig', () => ({ dataKey: 'private-key', dataSecret: 'private-secret' }))
  vi.stubGlobal('getHeader', (event: { authorization?: string }) => event.authorization)
  vi.stubGlobal('getQuery', (event: { query?: Record<string, string> }) => event.query || {})
  vi.stubGlobal('createError', ({ statusCode, statusMessage }: { statusCode: number, statusMessage: string }) =>
    Object.assign(new Error(statusMessage), { statusCode }))
  vi.stubGlobal('connectDb', connectDb)
  vi.stubGlobal('setHeader', vi.fn())
  vi.stubGlobal('sendStream', async (_event: unknown, stream: Readable) => text(stream))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GET /api/data/applications', () => {
  it.each([undefined, 'Bearer wrong-key', 'Basic private-key'])(
    'rejects a missing or invalid authorization header: %s',
    async (authorization) => {
      await expect(handler({ authorization })).rejects.toMatchObject({ statusCode: 401 })
      expect(connectDb).not.toHaveBeenCalled()
      expect(SubmissionModel.find).not.toHaveBeenCalled()
      expect(FormEntryModel.find).not.toHaveBeenCalled()
    }
  )

  it('fails closed if credentials are unset', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({ dataKey: '', dataSecret: 'private-secret' }))
    await expect(handler({ authorization: 'Bearer private-key' })).rejects.toMatchObject({ statusCode: 503 })
    expect(connectDb).not.toHaveBeenCalled()
  })

  it('returns every column in order, using the earliest initial entry and the submission status', async () => {
    const query = mockPage([
      {
        submissionId: 's1',
        projectId: 'project-1',
        status: 'Accepted',
        completedAt: new Date('2026-01-10'),
        createdAt: new Date('2026-01-09'),
        createdBy: 'user-sub',
        mappedFields: { FirstName: 'Ana', ParentPhone2: '3135550100', FifthChoiceSchool: 'Cass Tech', privateNote: 'excluded' }
      },
      {
        submissionId: 's2',
        projectId: 'project-1',
        status: 'In Progress',
        completedAt: new Date('2026-02-02'),
        createdAt: new Date('2026-02-01'),
        createdBy: 'user-2',
        mappedFields: {}
      }
    ], 2)
    const entryQuery = mockEntries([
      {
        submissionId: 's1',
        formType: 'initial',
        entryId: 'entry-1',
        formId: 'form-1',
        completedAt: new Date('2026-01-05'),
        createdBy: 'user-1',
        createdAt: new Date('2026-01-01'),
        entryVersionId: 'version-1',
        openedForEditingAt: new Date('2026-01-03')
      },
      { submissionId: 's1', formType: 'initial', entryId: 'entry-later', formId: 'form-2' }
    ])

    const result = await handler({ authorization: 'Bearer private-key', query: { page: '2', limit: '2' } }) as {
      applications: Record<string, unknown>[]
      total: number
      page: number
      limit: number
    }

    expect(query.select).toHaveBeenCalledWith(expect.stringContaining('mappedFields.FifthChoiceSchool'))
    expect(query.skip).toHaveBeenCalledWith(2)
    expect(query.limit).toHaveBeenCalledWith(2)
    expect(FormEntryModel.find).toHaveBeenCalledWith({ submissionId: { $in: ['s1', 's2'] }, formType: 'initial' })
    expect(entryQuery.sort).toHaveBeenCalledWith({ createdAt: 1, _id: 1 })
    expect(result).toMatchObject({ total: 2, page: 2, limit: 2 })
    expect(Object.keys(result.applications[0] || {})).toEqual(expectedColumns)
    expect(result.applications[0]).toMatchObject({
      formType: 'initial',
      submissionId: 's1',
      projectId: 'project-1',
      entryId: 'entry-1',
      formId: 'form-1',
      status: 'Accepted',
      completedAt: new Date('2026-01-05'),
      createdBy: 'user-1',
      createdAt: new Date('2026-01-01'),
      entryVersionId: 'version-1',
      openedForEditingAt: new Date('2026-01-03'),
      FirstName: 'Ana',
      LastName: null,
      ParentPhone2: '3135550100',
      FifthChoiceSchool: 'Cass Tech'
    })
    expect(result.applications[0]).not.toHaveProperty('privateNote')
    expect(result.applications[1]).toMatchObject({
      formType: null,
      entryId: null,
      formId: null,
      status: 'In Progress',
      completedAt: new Date('2026-02-02'),
      createdBy: 'user-2',
      createdAt: new Date('2026-02-01'),
      entryVersionId: null,
      openedForEditingAt: null
    })
  })

  it('excludes withdrawn submissions from both the page and total', async () => {
    mockPage([], 0)
    await handler({ authorization: 'Bearer private-key' })
    const filter = vi.mocked(SubmissionModel.find).mock.calls[0]?.[0] as unknown as { status: { $not: RegExp } }

    expect(SubmissionModel.countDocuments).toHaveBeenCalledWith(filter)
    expect(filter.status.$not.test('Withdrawn')).toBe(true)
    expect(filter.status.$not.test('Accepted')).toBe(false)
    expect(FormEntryModel.find).not.toHaveBeenCalled()
  })

  it.each([{ page: '0' }, { limit: '101' }])('rejects invalid pagination: %j', async (query) => {
    await expect(handler({ authorization: 'Bearer private-key', query })).rejects.toMatchObject({ statusCode: 400 })
    expect(connectDb).not.toHaveBeenCalled()
  })

  it('streams a CSV with the exact header and formats every phone column', async () => {
    const phones = {
      ParentPhone: '313.555.0101',
      ParentPhone2: '1-313-555-0102',
      Phone: '+1 (313) 555-0103',
      Ref1Phone: '3135550104',
      Ref2Phone: '+44 20 7946 0958',
      Ref3Phone: '313-555-0106 ext 7'
    }
    const submissions = Array.from({ length: 251 }, (_, index) => ({
      submissionId: `s${index}`,
      projectId: 'project-1',
      status: 'Accepted',
      mappedFields: index === 0 ? { ...phones, Essay: '=SUM(A1)', StudentNumber: '00123' } : {}
    }))
    const { cursor, query } = mockCursor(submissions)
    mockEntries([{ submissionId: 's0', formType: 'initial', entryId: 'entry-0', formId: 'form-1', createdAt: new Date('2026-01-01T00:00:00Z') }])

    const event = { authorization: 'Bearer private-key', query: { format: 'csv', page: '0' } }
    const csv = await handler(event) as string
    const rows = parse(csv, { columns: true }) as Record<string, string>[]

    expect(csv.split('\r\n')[0]).toBe(expectedColumns.join(','))
    expect(rows).toHaveLength(251)
    expect(query.skip).not.toHaveBeenCalled()
    expect(SubmissionModel.countDocuments).not.toHaveBeenCalled()
    expect(FormEntryModel.find).toHaveBeenCalledTimes(2)
    expect(cursor.close).toHaveBeenCalledOnce()
    expect(rows[0]).toMatchObject({
      formType: 'initial',
      entryId: 'entry-0',
      status: 'Accepted',
      createdAt: '2026-01-01T00:00:00.000Z',
      ParentPhone: '(313) 555-0101',
      ParentPhone2: '(313) 555-0102',
      Phone: '(313) 555-0103',
      Ref1Phone: '(313) 555-0104',
      Ref2Phone: '\'+44 20 7946 0958',
      Ref3Phone: '313-555-0106 ext 7',
      Essay: '\'=SUM(A1)',
      StudentNumber: '00123'
    })
    expect(setHeader).toHaveBeenCalledWith(event, 'Content-Disposition', 'attachment; filename="applications.csv"')
  })

  it('returns just the CSV header for an empty export', async () => {
    const { cursor } = mockCursor([])
    const csv = await handler({ authorization: 'Bearer private-key', query: { format: 'csv' } })

    expect(csv).toBe(`${expectedColumns.join(',')}\r\n`)
    expect(FormEntryModel.find).not.toHaveBeenCalled()
    expect(cursor.close).toHaveBeenCalledOnce()
  })
})
