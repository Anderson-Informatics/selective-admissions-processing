import { afterEach, describe, expect, it, vi } from 'vitest'
import { submittableRequest } from './submittable'

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
