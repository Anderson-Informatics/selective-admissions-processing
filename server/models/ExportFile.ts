import mongoose, { Schema } from 'mongoose'

export interface ExportFile {
  jobId: string
  name: string
  data: Buffer
  expiresAt: Date
  createdAt?: Date
}

const exportFileSchema = new Schema<ExportFile>({
  jobId: { type: String, required: true, index: true },
  name: { type: String, required: true },
  data: { type: Buffer, required: true },
  // PII exports are disclosure copies; expire them automatically.
  expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } }
}, { timestamps: { createdAt: true, updatedAt: false } })

export const ExportFileModel: mongoose.Model<ExportFile> = (mongoose.models.ExportFile as mongoose.Model<ExportFile>) || mongoose.model<ExportFile>('ExportFile', exportFileSchema)
