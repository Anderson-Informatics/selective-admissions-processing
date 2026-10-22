import { text } from 'node:stream/consumers'
import type { Readable } from 'node:stream'
import { parse } from 'csv-parse/sync'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { CycleModel } from '../../models/Cycle'
import { MetadataModel } from '../../models/Metadata'
import { SubmissionModel } from '../../models/Submission'

vi.mock('../../models/Cycle', () => ({
  CycleModel: {
    find: vi.fn()
  }
}))

vi.mock('../../models/Metadata', () => ({
  MetadataModel: {
    find: vi.fn()
  }
}))

vi.mock('../../models/Submission', () => ({
  SubmissionModel: {
    find: vi.fn(),
    countDocuments: vi.fn()
  }
}))

let handler: (event: unknown) => Promise<unknown>
const connectDb = vi.fn(async () => {})

beforeAll(async () => {
  vi.stubGlobal('defineEventHandler', (fn: typeof handler) => fn)
  handler = (await import('./applicants.get')).default as typeof handler
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

describe('GET /api/data/applicants', () => {
  it.each([undefined, 'Bearer wrong-key', 'Basic private-key', 'Bearer private-key extra'])(
    'rejects a missing or invalid authorization header: %s',
    async (authorization) => {
      await expect(handler({ authorization })).rejects.toMatchObject({ statusCode: 401 })
      expect(connectDb).not.toHaveBeenCalled()
      expect(SubmissionModel.find).not.toHaveBeenCalled()
      expect(MetadataModel.find).not.toHaveBeenCalled()
      expect(CycleModel.find).not.toHaveBeenCalled()
    }
  )

  it.each([
    { dataKey: '', dataSecret: 'private-secret' },
    { dataKey: 'private-key', dataSecret: '' }
  ])('fails closed if either credential is unset', async (config) => {
    vi.stubGlobal('useRuntimeConfig', () => config)
    await expect(handler({ authorization: 'Bearer private-key' })).rejects.toMatchObject({ statusCode: 503 })
    expect(connectDb).not.toHaveBeenCalled()
  })

  it('uses completedAt for submissionDate and null when it is missing', async () => {
    const submissions = [
      {
        submissionId: 's1',
        submissionIdInt: 42,
        projectId: 'project-1',
        cycleId: 'cycle-1',
        completedAt: new Date('2026-05-06'),
        submissionDate: new Date('2026-01-01'),
        mappedFields: {
          submissionDate: '2026-02-03',
          StudentNumber: '00123',
          FirstName: 'Ana',
          LastName: 'Lee',
          FullName: 'Ana Lee',
          DOB: '2012-03-04',
          ParentFirstName: 'Pat',
          ParentLastName: 'Lee',
          ParentPhone: '+1 (313) 555-1234',
          ParentEmail: 'pat@example.test',
          privateNote: 'must not be included'
        }
      },
      { submissionId: 's2', projectId: 'project-1', cycleId: 'cycle-2', mappedFields: { SubmissionDate: '2026-03-04' } },
      { submissionId: 's3', projectId: 'project-2', cycleId: 'cycle-2', completedAt: new Date('2026-04-05'), mappedFields: {} }
    ]
    const query = {
      select: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue(submissions)
    }
    vi.mocked(SubmissionModel.find).mockReturnValue(query as never)
    vi.mocked(SubmissionModel.countDocuments).mockResolvedValue(3)
    const metadataQuery = {
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([{ externalId: 'project-1', name: 'High School Admissions' }])
    }
    vi.mocked(MetadataModel.find).mockReturnValue(metadataQuery as never)
    const cycleQuery = {
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([{ _id: 'cycle-1', year: '2026-2027' }])
    }
    vi.mocked(CycleModel.find).mockReturnValue(cycleQuery as never)

    const result = await handler({ authorization: 'Bearer private-key', query: { format: 'json', page: '2', limit: '3' } })

    expect(connectDb).toHaveBeenCalledOnce()
    expect(query.select).toHaveBeenCalledWith(expect.stringContaining('completedAt'))
    expect(query.sort).toHaveBeenCalledWith({ _id: 1 })
    expect(query.skip).toHaveBeenCalledWith(3)
    expect(query.limit).toHaveBeenCalledWith(3)
    expect(MetadataModel.find).toHaveBeenCalledWith({
      type: 'project',
      externalId: { $in: ['project-1', 'project-2'] }
    })
    expect(metadataQuery.select).toHaveBeenCalledWith('externalId name')
    expect(CycleModel.find).toHaveBeenCalledWith({ _id: { $in: ['cycle-1', 'cycle-2'] } })
    expect(cycleQuery.select).toHaveBeenCalledWith('_id year')
    expect(result).toEqual({
      applicants: [
        {
          submissionId: 's1',
          submissionIdInt: 42,
          submissionDate: new Date('2026-05-06'),
          Application: 'High School Admissions',
          Year: '2026-2027',
          StudentNumber: '00123',
          FirstName: 'Ana',
          LastName: 'Lee',
          FullName: 'Ana Lee',
          DOB: '2012-03-04',
          ParentFirstName: 'Pat',
          ParentLastName: 'Lee',
          ParentPhone: '+1 (313) 555-1234',
          ParentEmail: 'pat@example.test'
        },
        {
          submissionId: 's2',
          submissionIdInt: null,
          submissionDate: null,
          Application: 'High School Admissions',
          Year: null,
          StudentNumber: null,
          FirstName: null,
          LastName: null,
          FullName: null,
          DOB: null,
          ParentFirstName: null,
          ParentLastName: null,
          ParentPhone: null,
          ParentEmail: null
        },
        {
          submissionId: 's3',
          submissionIdInt: null,
          submissionDate: new Date('2026-04-05'),
          Application: null,
          Year: null,
          StudentNumber: null,
          FirstName: null,
          LastName: null,
          FullName: null,
          DOB: null,
          ParentFirstName: null,
          ParentLastName: null,
          ParentPhone: null,
          ParentEmail: null
        }
      ],
      total: 3,
      page: 2,
      limit: 3
    })
  })

  it('returns null for missing project and cycle IDs without querying project metadata', async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([{ submissionId: 's4', mappedFields: {} }])
    }
    vi.mocked(SubmissionModel.find).mockReturnValue(query as never)
    vi.mocked(SubmissionModel.countDocuments).mockResolvedValue(1)

    const result = await handler({ authorization: 'Bearer private-key' }) as { applicants: { Application: string | null, Year: string | null }[] }

    expect(result.applicants[0]).toMatchObject({ Application: null, Year: null })
    expect(MetadataModel.find).not.toHaveBeenCalled()
    expect(CycleModel.find).not.toHaveBeenCalled()
  })

  it('excludes withdrawn submissions from both the page and total', async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([{ submissionId: 'active', mappedFields: {} }])
    }
    vi.mocked(SubmissionModel.find).mockReturnValue(query as never)
    vi.mocked(SubmissionModel.countDocuments).mockResolvedValue(1)

    const result = await handler({ authorization: 'Bearer private-key' }) as { applicants: { submissionId: string }[], total: number }
    const filter = vi.mocked(SubmissionModel.find).mock.calls[0]?.[0] as { status?: { $not?: RegExp } }

    expect(SubmissionModel.countDocuments).toHaveBeenCalledWith(filter)
    expect(filter.status?.$not).toBeInstanceOf(RegExp)
    expect(filter.status?.$not?.test('withdrawn')).toBe(true)
    expect(filter.status?.$not?.test('Withdrawn')).toBe(true)
    expect(filter.status?.$not?.test('submitted')).toBe(false)
    expect(result.applicants.map(applicant => applicant.submissionId)).toEqual(['active'])
    expect(result.total).toBe(1)
  })

  it.each([{ page: '0' }, { page: 'abc' }, { page: '9007199254740991' }, { limit: '101' }, { limit: '0' }])(
    'rejects invalid pagination without querying the database: %j',
    async (query) => {
      await expect(handler({ authorization: 'Bearer private-key', query })).rejects.toMatchObject({ statusCode: 400 })
      expect(connectDb).not.toHaveBeenCalled()
    }
  )

  it('streams all non-withdrawn applicants as a downloadable CSV, ignoring pagination', async () => {
    const phones = [
      '+1 (313) 555-0123',
      '313.555.0124',
      '1-313-555-0125',
      '+44 20 7946 0958',
      '313-555-0126 ext 7',
      '=HYPERLINK("https://example.test")'
    ]
    const submissions = Array.from({ length: 251 }, (_, index) => ({
      submissionId: `s${index}`,
      projectId: 'project-1',
      cycleId: 'cycle-1',
      completedAt: index === 0 ? new Date('2026-05-06T12:00:00Z') : undefined,
      mappedFields: index === 0
        ? { StudentNumber: '00123', FirstName: '=1+1', LastName: 'A,"B"\nC', ParentPhone: phones[index], ParentEmail: 'a@example.test' }
        : { ParentPhone: phones[index] }
    }))
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
    vi.mocked(MetadataModel.find).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([{ externalId: 'project-1', name: 'Admissions' }])
    } as never)
    vi.mocked(CycleModel.find).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([{ _id: 'cycle-1', year: '2026-2027' }])
    } as never)

    const event = { authorization: 'Bearer private-key', query: { format: 'csv', page: '0', limit: '999' } }
    const csv = await handler(event) as string
    const rows = parse(csv, { columns: true }) as Record<string, string>[]
    const filter = vi.mocked(SubmissionModel.find).mock.calls[0]?.[0] as unknown as { status: { $not: RegExp } }

    expect(filter.status.$not.test('Withdrawn')).toBe(true)
    expect(query.select).toHaveBeenCalledWith(expect.stringContaining('completedAt'))
    expect(query.sort).toHaveBeenCalledWith({ _id: 1 })
    expect(query.skip).not.toHaveBeenCalled()
    expect(query.limit).not.toHaveBeenCalled()
    expect(SubmissionModel.countDocuments).not.toHaveBeenCalled()
    expect(MetadataModel.find).toHaveBeenCalledTimes(2)
    expect(CycleModel.find).toHaveBeenCalledTimes(2)
    expect(cursor.close).toHaveBeenCalledOnce()
    expect(rows).toHaveLength(251)
    expect(Object.keys(rows[0] || {})).toEqual([
      'submissionId', 'submissionIdInt', 'submissionDate', 'Application', 'Year',
      'StudentNumber', 'FirstName', 'LastName', 'FullName', 'DOB',
      'ParentFirstName', 'ParentLastName', 'ParentPhone', 'ParentEmail'
    ])
    expect(rows[0]).toMatchObject({
      submissionId: 's0',
      submissionIdInt: '',
      submissionDate: '2026-05-06T12:00:00.000Z',
      Application: 'Admissions',
      Year: '2026-2027',
      StudentNumber: '00123',
      FirstName: '\'=1+1',
      LastName: 'A,"B"\nC',
      ParentPhone: '(313) 555-0123',
      ParentEmail: 'a@example.test'
    })
    expect(rows.slice(1, 6).map(row => row.ParentPhone)).toEqual([
      '(313) 555-0124',
      '(313) 555-0125',
      '\'+44 20 7946 0958',
      '313-555-0126 ext 7',
      '\'=HYPERLINK("https://example.test")'
    ])
    expect(rows[250]?.submissionId).toBe('s250')
    expect(setHeader).toHaveBeenCalledWith(event, 'Content-Type', 'text/csv; charset=utf-8')
    expect(setHeader).toHaveBeenCalledWith(event, 'Content-Disposition', 'attachment; filename="applicants.csv"')
    expect(setHeader).toHaveBeenCalledWith(event, 'Cache-Control', 'no-store')
  })

  it('returns just the CSV header for an empty export', async () => {
    const cursor = {
      async* [Symbol.asyncIterator]() {},
      close: vi.fn()
    }
    vi.mocked(SubmissionModel.find).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnThis(),
      lean: vi.fn().mockReturnThis(),
      cursor: vi.fn().mockReturnValue(cursor)
    } as never)

    const csv = await handler({ authorization: 'Bearer private-key', query: { format: 'csv' } }) as string
    expect(csv).toMatch(/^submissionId,submissionIdInt,submissionDate,Application,Year,.*ParentEmail\r\n$/)
    expect(MetadataModel.find).not.toHaveBeenCalled()
    expect(CycleModel.find).not.toHaveBeenCalled()
    expect(cursor.close).toHaveBeenCalledOnce()
  })

  it.each(['xml', '', ['csv', 'json']])('rejects invalid format %j before database access', async (format) => {
    await expect(handler({ authorization: 'Bearer private-key', query: { format } }))
      .rejects.toMatchObject({ statusCode: 400 })
    expect(connectDb).not.toHaveBeenCalled()
  })
})
