import mongoose from 'mongoose'
import { JobModel } from '../../server/models/Job'
import { leasePendingChildJobs } from '../../server/utils/jobDispatcher'

export async function dispatchPendingJobs(siteUrl: string) {
  const mongodbUri = process.env.NUXT_MONGODB_URI
  const secret = process.env.NUXT_JOB_DISPATCH_SECRET
  if (!mongodbUri || !secret) throw new Error('Job dispatcher environment is not configured')

  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(mongodbUri, { bufferCommands: false })
  }

  const concurrency = Math.max(1, Number(process.env.NUXT_JOB_CONCURRENCY || 3))
  const jobs = await leasePendingChildJobs(concurrency, 16, Number(process.env.NUXT_JOB_MAX_ATTEMPTS || 3))

  await Promise.all(jobs.map(async (job) => {
    const response = await fetch(`${siteUrl}/.netlify/functions/process-job-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: String(job._id), secret })
    })
    if (!response.ok) {
      await JobModel.findByIdAndUpdate(job._id, { $set: { leaseExpiresAt: new Date(0) } })
      throw new Error(`Failed to dispatch job ${job._id}: ${response.status}`)
    }
  }))

  return jobs.map(job => String(job._id))
}
