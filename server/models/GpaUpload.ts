import mongoose, { Schema, type Types } from 'mongoose'

export type GpaUploadSource = 'dpscd' | 'opt_in'
export type GpaUploadStatus = 'previewing' | 'importing' | 'ready' | 'confirming' | 'completed' | 'failed' | 'cancelled'

export interface GpaUploadFile {
  name: string
  content: string
  size: number
}

export interface GpaUpload {
  cycleId: string
  createdBy: string
  source: GpaUploadSource
  status: GpaUploadStatus
  files: GpaUploadFile[]
  records?: Record<string, unknown>[]
  preview?: Record<string, unknown>
  result?: Record<string, unknown>
  previewJobId?: Types.ObjectId
  commitJobId?: Types.ObjectId
  importJobId?: Types.ObjectId
  error?: string
  expiresAt: Date
  createdAt?: Date
  updatedAt?: Date
}

const gpaUploadSchema = new Schema<GpaUpload>({
  cycleId: { type: String, required: true, index: true },
  createdBy: { type: String, required: true, index: true },
  source: { type: String, required: true, index: true },
  status: { type: String, required: true, index: true },
  files: [{
    name: { type: String, required: true },
    content: { type: String, required: true },
    size: { type: Number, required: true }
  }],
  records: { type: [Schema.Types.Mixed] },
  preview: { type: Schema.Types.Mixed },
  result: { type: Schema.Types.Mixed },
  previewJobId: { type: Schema.Types.ObjectId, ref: 'Job' },
  commitJobId: { type: Schema.Types.ObjectId, ref: 'Job' },
  importJobId: { type: Schema.Types.ObjectId, ref: 'Job' },
  error: String,
  expiresAt: { type: Date, required: true, index: { expires: 0 } }
}, { timestamps: true })

export const GpaUploadModel: mongoose.Model<GpaUpload> = (mongoose.models.GpaUpload as mongoose.Model<GpaUpload>) || mongoose.model<GpaUpload>('GpaUpload', gpaUploadSchema)
