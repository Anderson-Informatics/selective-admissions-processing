import mongoose from 'mongoose'
import { JobModel, type JobStatus } from '../models/Job'
import { HSPTUploadModel } from '../models/HSPTUpload'
import { GpaUploadModel } from '../models/GpaUpload'
import { runJob } from './jobs'
import type { SubmittableClientConfig } from './submittable'

export interface JobWorkerConfig {
  mongodbUri: string
  submittable: SubmittableClientConfig
  hereApiKey?: string
  maxAttempts?: number
}

async function connectWorkerDb(uri: string) {
  if (mongoose.connection.readyState === 1) return
  await mongoose.connect(uri)
}

export async function updateParentJob(parentJobId: string) {
  const [parent, children] = await Promise.all([
    JobModel.findById(parentJobId).lean(),
    JobModel.find({ parentJobId }).sort({ createdAt: 1 }).lean()
  ])
  if (!parent) return

  const forms = children.map(child => ({
    formId: child.formId || '',
    formName: child.formName || child.formId || '',
    childJobId: String(child._id),
    status: child.status,
    entries: child.result?.entries || 0,
    error: child.error
  }))
  const completed = children.filter(child => child.status === 'completed').length
  const failed = children.filter(child => child.status === 'failed').length
  const running = children.some(child => child.status === 'running')
  const total = children.length
  const status: JobStatus = failed ? 'failed' : completed === total ? 'completed' : running ? 'running' : 'waiting'
  const terminal = status === 'completed' || status === 'failed'

  await JobModel.findByIdAndUpdate(parentJobId, {
    $set: {
      status,
      result: {
        ...parent.result,
        forms,
        entries: forms.reduce((sum, form) => sum + form.entries, 0)
      },
      progress: {
        phase: terminal ? status : 'extracting',
        total,
        processed: completed,
        percent: total ? Math.round((completed / total) * 100) : 100,
        message: failed ? `${failed} of ${total} forms failed` : `Extracted ${completed} of ${total} forms`
      },
      ...(terminal ? { completedAt: new Date() } : {})
    }
  })
}

export async function processQueuedJob(jobId: string, config: JobWorkerConfig) {
  await connectWorkerDb(config.mongodbUri)
  const now = new Date()
  const job = await JobModel.findOneAndUpdate(
    {
      _id: jobId,
      status: 'pending',
      leaseExpiresAt: { $gt: now }
    },
    {
      $set: { status: 'running', startedAt: now, error: undefined },
      $inc: { attempts: 1 }
    },
    { returnDocument: 'after' }
  )

  if (!job) return { claimed: false }
  if (job.parentJobId) await updateParentJob(String(job.parentJobId))

  const heartbeat = setInterval(() => {
    void JobModel.updateOne(
      { _id: job._id, status: 'running' },
      { $set: { leaseExpiresAt: new Date(Date.now() + 16 * 60_000) } }
    ).catch(error => console.error(`Failed to renew lease for job ${job._id}`, error))
  }, 60_000)

  try {
    const uploadRecovery: Record<string, { field: string, status: 'previewing' | 'confirming' | 'importing' }> = {
      hspt_upload_preview: { field: 'previewJobId', status: 'previewing' },
      hspt_upload_commit: { field: 'commitJobId', status: 'confirming' },
      dpscd_gpa_import: { field: 'importJobId', status: 'importing' },
      optin_gpa_preview: { field: 'previewJobId', status: 'previewing' },
      optin_gpa_commit: { field: 'commitJobId', status: 'confirming' }
    }
    const recovery = uploadRecovery[job.type]
    if (job.attempts > 1 && recovery && job.payload?.uploadId) {
      const filter = { _id: job.payload.uploadId, cycleId: job.cycleId, [recovery.field]: job._id, status: 'failed' as const }
      const update = { $set: { status: recovery.status, error: undefined } }
      if (job.type.startsWith('hspt_')) await HSPTUploadModel.updateOne(filter, update)
      else await GpaUploadModel.updateOne(filter, update)
    }
    await runJob(job, { submittable: config.submittable, hereApiKey: config.hereApiKey })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    const exhausted = job.attempts >= (config.maxAttempts || 3)
    if (exhausted && job.routingLock) await JobModel.updateOne({ _id: job._id }, { $unset: { routingLock: 1 } })
    if (!exhausted) {
      await JobModel.findByIdAndUpdate(job._id, {
        $set: {
          status: 'pending',
          error: message,
          completedAt: undefined,
          leaseExpiresAt: new Date(0)
        }
      })
    }
  } finally {
    clearInterval(heartbeat)
  }

  if (job.parentJobId) await updateParentJob(String(job.parentJobId))
  return { claimed: true }
}
