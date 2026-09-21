import { dispatchPendingJobs } from '../lib/dispatch'
import { processQueuedJob } from '../../server/utils/jobWorker'

export const config = { background: true }

export default async function handler(request: Request) {
  const body = await request.json().catch(() => ({})) as { jobId?: string, secret?: string }
  const secret = process.env.NUXT_JOB_DISPATCH_SECRET
  const mongodbUri = process.env.NUXT_MONGODB_URI
  const apiKey = process.env.NUXT_SUBMITTABLE_API_KEY

  if (!secret || body.secret !== secret) throw new Error('Unauthorized job dispatch')
  if (!body.jobId) throw new Error('jobId is required')
  if (!mongodbUri || !apiKey) throw new Error('Worker environment is not configured')

  await processQueuedJob(body.jobId, {
    mongodbUri,
    submittable: {
      apiKey,
      baseUrl: process.env.NUXT_SUBMITTABLE_BASE_URL,
      v3BaseUrl: process.env.NUXT_SUBMITTABLE_V3_BASE_URL
    },
    hereApiKey: process.env.NUXT_HERE_API_KEY,
    maxAttempts: Number(process.env.NUXT_JOB_MAX_ATTEMPTS || 3)
  })

  try {
    await dispatchPendingJobs(new URL(request.url).origin)
  } catch (error) {
    console.error('Follow-up job dispatch failed; scheduled dispatch will retry', error)
  }
}
