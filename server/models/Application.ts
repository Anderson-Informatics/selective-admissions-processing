import mongoose, { Schema } from 'mongoose'

export interface Application {
  cycleId: string
  name: string
  type: 'exam' | 'application' | 'dsa' | string
  projectId: string
  initialFormId?: string
  active: boolean
  createdAt?: Date
  updatedAt?: Date
}

const applicationSchema = new Schema<Application>({
  cycleId: { type: String, required: true, index: true },
  name: { type: String, required: true },
  type: { type: String, default: 'exam' },
  projectId: { type: String, required: true },
  initialFormId: String,
  active: { type: Boolean, default: true }
}, { timestamps: true })

applicationSchema.index({ cycleId: 1, projectId: 1 }, { unique: true })

export const ApplicationModel: mongoose.Model<Application> = (mongoose.models.Application as mongoose.Model<Application>) || mongoose.model<Application>('Application', applicationSchema)
