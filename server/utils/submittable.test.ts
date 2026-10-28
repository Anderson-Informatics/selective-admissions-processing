import { afterEach, describe, expect, it, vi } from 'vitest'
import { addSubmissionLabel, addSubmissionLabelBulk, fetchSubmission, fetchSubmissionsForProject, removeSubmissionLabel, submittableRequest } from './submittable'

vi.mock('./submittableRateLimit', () => ({
  waitForSubmittableRequestSlot: vi.fn(async () => {})
}))

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('submittableRequest rate-limit handling', () => {
  it('waits for Retry-After and retries a 429 response', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('quota exceeded', { status: 429, headers: { 'Retry-After': '1' } }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const request = submittableRequest<{ ok: boolean }>('/projects', {}, {
      apiKey: 'Basic test-token',
      baseUrl: 'https://example.test/v4'
    })

    await vi.advanceTimersByTimeAsync(999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)

    await expect(request).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('throws after the bounded number of 429 retries', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue(new Response('quota exceeded', { status: 429, statusText: 'Too Many Requests' }))
    vi.stubGlobal('fetch', fetchMock)

    const request = submittableRequest('/projects', {}, {
      apiKey: 'Basic test-token',
      baseUrl: 'https://example.test/v4'
    })
    const assertion = expect(request).rejects.toThrow('Submittable API error 429')

    await vi.runAllTimersAsync()
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })
})

describe('submission labels', () => {
  const config = { apiKey: 'Basic test-token', baseUrl: 'https://example.test/v4' }

  it('accepts empty success responses when adding or removing a label', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response('', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await addSubmissionLabel('sub-1', 'label-1', config)
    await removeSubmissionLabel('sub-1', 'label-1', config)
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://example.test/v4/submissions/sub-1/labels/label-1', expect.objectContaining({ method: 'PUT' }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://example.test/v4/submissions/sub-1/labels/label-1', expect.objectContaining({ method: 'DELETE' }))
  })

  it('normalizes label IDs from list and detail responses', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ submissionId: 'sub-1', labels: [{ labelId: 'label-1' }, 'label-2'] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ submissionId: 'sub-1', labels: [{ labelId: 'label-1' }] }] }))))

    expect((await fetchSubmission('sub-1', config)).labels).toEqual(['label-1', 'label-2'])
    expect((await fetchSubmissionsForProject('project-1', config))[0]?.labels).toEqual(['label-1'])
  })

  it('deduplicates submissions and applies one label through the bulk endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ submissionIds: ['sub-1', 'sub-2'] })))
    vi.stubGlobal('fetch', fetchMock)
    await addSubmissionLabelBulk(['sub-1', 'sub-1', 'sub-2'], 'label-1', config)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith('https://example.test/v4/submissions/labels', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ labelId: 'label-1', submissionIds: ['sub-1', 'sub-2'] })
    }))
  })

  it('chunks bulk label requests at 500 submissions and skips empty batches', async () => {
    const ids = Array.from({ length: 501 }, (_, index) => `sub-${index}`)
    const fetchMock = vi.fn().mockImplementation(async (_url: string, options: RequestInit) => new Response(JSON.stringify({
      submissionIds: JSON.parse(String(options.body)).submissionIds
    })))
    vi.stubGlobal('fetch', fetchMock)
    await addSubmissionLabelBulk([], 'label-1', config)
    await addSubmissionLabelBulk(ids, 'label-1', config)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).submissionIds).toHaveLength(500)
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body).submissionIds).toEqual(['sub-500'])
  })

  it('does not treat a partial bulk response as a fully applied label', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ submissionIds: ['sub-1'] }))))
    await expect(addSubmissionLabelBulk(['sub-1', 'sub-2'], 'label-1', config)).rejects.toThrow('Bulk label')
  })
})
