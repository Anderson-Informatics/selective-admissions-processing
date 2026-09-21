import mongoose, { Schema, type Types } from 'mongoose'

export type JobType = 'metadata_sync' | 'submission_extraction' | 'submission_extraction_form' | 'form_response_mapping' | 'run_validation' | 'refresh_review_completion' | 'score_compilation' | 'hspt_upload_preview' | 'hspt_upload_commit' | 'catchment_lookup' | 'dpscd_gpa_import' | 'optin_gpa_preview' | 'optin_gpa_commit'
export type JobStatus = 'pending' | 'waiting' | 'running' | 'completed' | 'failed'

export interface JobProgress {
  phase?: string
  total?: number
  processed?: number
  percent?: number
  message?: string
}

export interface JobFormResult {
  formId: string
  formName: string
  childJobId: string
  status: JobStatus
  entries: number
  error?: string
}

export interface Job {
  type: JobType
  status: JobStatus
  cycleId: string
  createdBy: string
  parentJobId?: Types.ObjectId
  formId?: string
  formName?: string
  payload: any
  result?: any
  error?: string
  progress?: JobProgress
  attempts: number
  leaseExpiresAt?: Date
  startedAt?: Date
  completedAt?: Date
  createdAt?: Date
  updatedAt?: Date
}

const jobSchema = new Schema<Job>({
  type: { type: String, required: true, index: true },
  status: { type: String, required: true, default: 'pending', index: true },
  cycleId: { type: String, required: true, index: true },
  createdBy: { type: String, required: true },
  parentJobId: { type: Schema.Types.ObjectId, ref: 'Job', index: true },
  formId: { type: String, index: true },
  formName: String,
  payload: { type: Schema.Types.Mixed, default: {} },
  result: { type: Schema.Types.Mixed, default: {} },
  error: String,
  progress: {
    phase: String,
    total: Number,
    processed: Number,
    percent: Number,
    message: String
  },
  attempts: { type: Number, default: 0 },
  leaseExpiresAt: Date,
  startedAt: Date,
  completedAt: Date
}, { timestamps: true })

jobSchema.index({ status: 1, type: 1, leaseExpiresAt: 1, createdAt: 1 })

export const JobModel: mongoose.Model<Job> = (mongoose.models.Job as mongoose.Model<Job>) || mongoose.model<Job>('Job', jobSchema)
