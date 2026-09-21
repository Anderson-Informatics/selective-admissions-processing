import mongoose, { Schema, type Types } from 'mongoose'

export type HSPTUploadStatus = 'previewing' | 'ready' | 'confirming' | 'completed' | 'failed' | 'cancelled'

export interface HSPTUploadFile {
  name: string
  content: string
  size: number
}

export interface HSPTUploadPreview {
  files: number
  processed: number
  valid: number
  invalid: number
  errors: string[]
  matching: {
    linked: number
    needsReview: number
    unlinked: number
    byType: Record<string, number>
  }
}

export interface HSPTUploadResult {
  processed: number
  inserted: number
  updated: number
  errors: string[]
  matching: {
    exact: number
    fuzzy: number
    unmatched: number
    byType: Record<string, number>
  }
}

export interface HSPTUpload {
  cycleId: string
  createdBy: string
  status: HSPTUploadStatus
  files: HSPTUploadFile[]
  preview?: HSPTUploadPreview
  result?: HSPTUploadResult
  previewJobId?: Types.ObjectId
  commitJobId?: Types.ObjectId
  error?: string
  expiresAt: Date
  createdAt?: Date
  updatedAt?: Date
}

const hsptUploadSchema = new Schema<HSPTUpload>({
  cycleId: { type: String, required: true, index: true },
  createdBy: { type: String, required: true, index: true },
  status: { type: String, required: true, default: 'previewing', index: true },
  files: [{
    name: { type: String, required: true },
    content: { type: String, required: true },
    size: { type: Number, required: true }
  }],
  preview: { type: Schema.Types.Mixed },
  result: { type: Schema.Types.Mixed },
  previewJobId: { type: Schema.Types.ObjectId, ref: 'Job' },
  commitJobId: { type: Schema.Types.ObjectId, ref: 'Job' },
  error: String,
  expiresAt: { type: Date, required: true, index: { expires: 0 } }
}, { timestamps: true })

export const HSPTUploadModel: mongoose.Model<HSPTUpload> = (mongoose.models.HSPTUpload as mongoose.Model<HSPTUpload>) || mongoose.model<HSPTUpload>('HSPTUpload', hsptUploadSchema)
