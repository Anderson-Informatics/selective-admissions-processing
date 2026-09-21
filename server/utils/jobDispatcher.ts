import { JobModel } from '../models/Job'
import { updateParentJob } from './jobWorker'

export async function leasePendingChildJobs(limit: number, leaseMinutes = 16, maxAttempts = 3) {
  const jobs = []
  const now = new Date()
  const leaseExpiresAt = new Date(now.getTime() + leaseMinutes * 60_000)

  await JobModel.updateMany(
    { status: 'running', leaseExpiresAt: { $lte: now }, attempts: { $lt: maxAttempts } },
    { $set: { status: 'pending', leaseExpiresAt: new Date(0), error: 'Worker lease expired; queued for retry' } }
  )

  const exhausted = await JobModel.find({
    status: 'running',
    leaseExpiresAt: { $lte: now },
    attempts: { $gte: maxAttempts }
  }).select('_id parentJobId')
  if (exhausted.length) {
    await JobModel.updateMany(
      { _id: { $in: exhausted.map(job => job._id) } },
      { $set: { status: 'failed', completedAt: now, error: 'Worker lease expired after maximum retry attempts' } }
    )
    const parentIds = [...new Set(exhausted.map(job => job.parentJobId && String(job.parentJobId)).filter(Boolean))]
    await Promise.all(parentIds.map(parentJobId => updateParentJob(parentJobId!)))
  }

  const active = await JobModel.countDocuments({
    $or: [
      { status: 'running', leaseExpiresAt: { $gt: now } },
      { status: 'pending', leaseExpiresAt: { $gt: now } }
    ]
  })
  const available = Math.max(0, Math.max(1, limit) - active)

  for (let index = 0; index < available; index += 1) {
    const job = await JobModel.findOneAndUpdate(
      {
        status: 'pending',
        $or: [
          { leaseExpiresAt: { $exists: false } },
          { leaseExpiresAt: { $lte: now } }
        ]
      },
      { $set: { leaseExpiresAt } },
      { sort: { createdAt: 1 }, returnDocument: 'after' }
    )
    if (!job) break
    jobs.push(job)
  }

  return jobs
}
