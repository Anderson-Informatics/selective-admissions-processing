import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApplicationModel } from '../models/Application'
import { ReviewModel } from '../models/Review'
import { SubmissionModel } from '../models/Submission'
import { runRegistrationSync, sanitizeAccommodations } from './registrationSync'

vi.mock('../models/Application', () => ({ ApplicationModel: { find: vi.fn() } }))
vi.mock('../models/Review', () => ({ ReviewModel: { find: vi.fn() } }))
vi.mock('../models/Submission', () => ({ SubmissionModel: { find: vi.fn() } }))

const lean = (value: unknown) => ({ lean: async () => value })
const selectThenLean = (value: unknown) => ({ select: () => lean(value) })

const fetchMock = vi.fn()

function mockModels({ submissions = [], reviews = [] }: { submissions?: unknown[], reviews?: unknown[] } = {}) {
  vi.mocked(ApplicationModel.find).mockReturnValue(selectThenLean([{ _id: 'app-1' }]) as never)
  vi.mocked(SubmissionModel.find).mockReturnValue(selectThenLean(submissions) as never)
  vi.mocked(ReviewModel.find).mockReturnValue(selectThenLean(reviews) as never)
}

const submission = (overrides: Record<string, unknown> = {}) => ({
  submissionId: 'uuid-1',
  submissionIdInt: 1001,
  applicationId: 'app-1',
  status: 'submitted',
  mappedFields: { FirstName: 'Jane', LastName: 'Doe', FullName: 'Jane Doe' },
  ...overrides
})

const review = (overrides: Record<string, unknown> = {}) => ({
  submissionId: 'uuid-1',
  stageName: 'IEP Review',
  status: 'Completed',
  completedAt: new Date('2026-11-01'),
  mappedData: { Accommodations: 'Extended time' },
  ...overrides
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('useRuntimeConfig', () => ({ registrationApiKey: 'key', registrationBaseUrl: 'https://reg.test' }))
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => [] })
})

describe('sanitizeAccommodations', () => {
  it('replaces slashes and angle brackets with words', () => {
    expect(sanitizeAccommodations('1/2 time <50% >1hr')).toBe('1 2 time less than 50% greater than 1hr')
  })
})

describe('runRegistrationSync', () => {
  it('throws when the API key is missing', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({ registrationApiKey: '', registrationBaseUrl: '' }))
    await expect(runRegistrationSync({ cycleId: 'c1' })).rejects.toThrow('NUXT_REGISTRATION_API_KEY')
  })

  it('inserts new students with empty CheckIn/CheckOut/TestSession', async () => {
    mockModels({ submissions: [submission()], reviews: [review()] })
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ matched: 0, modified: 0, inserted: 1, errors: [] }) })

    const result = await runRegistrationSync({ cycleId: 'c1' })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://reg.test/api/external/students')
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('key')
    const body = JSON.parse(fetchMock.mock.calls[1]![1].body as string)
    expect(body).toEqual([{
      submissionIdUnique: 'uuid-1',
      SubmissionID: '1001',
      FirstName: 'Jane',
      LastName: 'Doe',
      FullName: 'Jane Doe',
      IEP: 'Yes',
      Accommodations: 'Extended time',
      CheckIn: '',
      CheckOut: '',
      TestSession: ''
    }])
    expect(result).toMatchObject({ inserts: 1, inserted: 1, matched: 0 })
  })

  it('sends only changed fields on update and never sends CheckIn/CheckOut/TestSession', async () => {
    mockModels({ submissions: [submission()], reviews: [review()] })
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ submissionIdUnique: 'uuid-1', SubmissionID: '1001', FirstName: 'Janet', LastName: 'Doe', FullName: 'Janet Doe', IEP: 'Yes', Accommodations: 'Extended time', CheckIn: { Registered: true } }] })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ matched: 1, modified: 1, inserted: 0, errors: [] }) })

    const result = await runRegistrationSync({ cycleId: 'c1' })
    const body = JSON.parse(fetchMock.mock.calls[1]![1].body as string)
    expect(body).toEqual([{ submissionIdUnique: 'uuid-1', FirstName: 'Jane', FullName: 'Jane Doe' }])
    expect(result).toMatchObject({ updates: 1, matched: 1, modified: 1 })
  })

  it('skips records with no differences', async () => {
    mockModels({ submissions: [submission()], reviews: [review()] })
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => [{ submissionIdUnique: 'uuid-1', SubmissionID: '1001', FirstName: 'Jane', LastName: 'Doe', FullName: 'Jane Doe', IEP: 'Yes', Accommodations: 'Extended time' }]
    })

    const result = await runRegistrationSync({ cycleId: 'c1' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ updates: 0, inserts: 0, unchanged: 1 })
  })

  it('does not overwrite remote values with empty local values', async () => {
    mockModels({ submissions: [submission({ mappedFields: { FirstName: '', LastName: 'Doe', FullName: '' } })], reviews: [review()] })
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => [{ submissionIdUnique: 'uuid-1', SubmissionID: '9999', FirstName: 'Jane', LastName: 'Doe', FullName: 'Jane Doe', IEP: 'Yes', Accommodations: 'Extended time' }]
    })

    await runRegistrationSync({ cycleId: 'c1' })
    const body = JSON.parse(fetchMock.mock.calls[1]![1].body as string)
    expect(body).toEqual([{ submissionIdUnique: 'uuid-1', SubmissionID: '1001' }])
  })

  it('marks IEP as MLL when only MLL review accommodations exist', async () => {
    mockModels({
      submissions: [submission()],
      reviews: [review({ stageName: 'MLL Review', mappedData: { MLLAccommodations: '1/2 time <50%' } })]
    })
    const result = await runRegistrationSync({ cycleId: 'c1' })
    const body = JSON.parse(fetchMock.mock.calls[1]![1].body as string)
    expect(body[0].IEP).toBe('MLL')
    expect(body[0].Accommodations).toBe('1 2 time less than 50%')
    expect(result.inserts).toBe(1)
  })

  it('marks IEP as No when no accommodations exist and omits Accommodations', async () => {
    mockModels({ submissions: [submission()], reviews: [] })
    await runRegistrationSync({ cycleId: 'c1' })
    const body = JSON.parse(fetchMock.mock.calls[1]![1].body as string)
    expect(body[0].IEP).toBe('No')
    expect(body[0]).not.toHaveProperty('Accommodations')
  })

  it('deletes remote records for withdrawn submissions', async () => {
    mockModels({ submissions: [submission({ status: 'Withdrawn' })] })
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ submissionIdUnique: 'uuid-1' }] })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ requested: 1, deleted: 1, notFound: [] }) })

    const result = await runRegistrationSync({ cycleId: 'c1' })

    expect(result.submissions).toBe(0)
    expect(result.deletes).toEqual([{ submissionIdUnique: 'uuid-1', name: 'Jane Doe' }])
    expect(result.deleted).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]![0]).toBe('https://reg.test/api/external/students/delete')
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body as string)).toEqual(['uuid-1'])
  })

  it('does not send a delete request when there are no withdrawn submissions', async () => {
    mockModels({ submissions: [submission()] })
    await runRegistrationSync({ cycleId: 'c1' })
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes('/delete'))).toBe(false)
  })

  it('compiles the diff without writing on dryRun', async () => {
    mockModels({ submissions: [submission()] })
    const result = await runRegistrationSync({ cycleId: 'c1', dryRun: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ inserts: 1, inserted: 0, dryRun: true })
  })

  it('aborts on 401', async () => {
    mockModels({ submissions: [submission()] })
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'unauthorized' })
    await expect(runRegistrationSync({ cycleId: 'c1' })).rejects.toThrow('401')
  })

  it('records per-record errors from upsert responses', async () => {
    mockModels({ submissions: [submission()] })
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ matched: 0, modified: 0, inserted: 0, errors: [{ index: 0, message: 'bad record' }] }) })

    const result = await runRegistrationSync({ cycleId: 'c1' })
    expect(result.errors).toEqual([{ index: 0, submissionIdUnique: 'uuid-1', message: 'bad record' }])
  })
})
