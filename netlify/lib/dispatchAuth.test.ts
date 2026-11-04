import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import dispatch from '../functions/dispatch-jobs'
import processJob from '../functions/process-job-background'
import { dispatchPendingJobs } from './dispatch'
import { processQueuedJob } from '../../server/utils/jobWorker'

vi.mock('./dispatch', () => ({ dispatchPendingJobs: vi.fn() }))
vi.mock('../../server/utils/jobWorker', () => ({ processQueuedJob: vi.fn() }))

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('NUXT_JOB_DISPATCH_SECRET', 'fixture-secret')
  vi.stubEnv('NUXT_MONGODB_URI', 'mongodb://example.test/fixture')
  vi.stubEnv('NUXT_SUBMITTABLE_API_KEY', 'fixture-key')
})

afterEach(() => vi.unstubAllEnvs())

describe('Netlify job authentication', () => {
  it.each([undefined, 'incorrect'])('rejects dispatcher requests with secret %s', async (secret) => {
    const response = await dispatch(new Request('https://example.test/.netlify/functions/dispatch-jobs', {
      headers: secret ? { 'x-job-dispatch-secret': secret } : {}
    }), {})
    expect(response.status).toBe(401)
    expect(dispatchPendingJobs).not.toHaveBeenCalled()
  })

  it('fails closed when the server dispatch secret is not configured', async () => {
    vi.stubEnv('NUXT_JOB_DISPATCH_SECRET', '')
    const response = await dispatch(new Request('https://example.test/.netlify/functions/dispatch-jobs'), {})
    expect(response.status).toBe(401)
    expect(dispatchPendingJobs).not.toHaveBeenCalled()
  })

  it('allows an authenticated dispatch without a user session', async () => {
    vi.mocked(dispatchPendingJobs).mockResolvedValue(['job-1'])
    const response = await dispatch(new Request('https://example.test/.netlify/functions/dispatch-jobs', {
      headers: { 'x-job-dispatch-secret': 'fixture-secret' }
    }), {})
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ dispatched: ['job-1'] })
  })

  it('rejects unauthenticated worker requests before processing jobs', async () => {
    await expect(processJob(new Request('https://example.test/.netlify/functions/process-job-background', {
      method: 'POST', body: JSON.stringify({ jobId: 'job-1', secret: 'incorrect' })
    }))).rejects.toThrow('Unauthorized')
    expect(processQueuedJob).not.toHaveBeenCalled()
    expect(dispatchPendingJobs).not.toHaveBeenCalled()
  })
})
