import mongoose, { Schema } from 'mongoose'

export interface EditingReminder {
  requestKey: string
  jobId: string
  cycleId: string
  submissionId: string
  actor: string
  status: 'pending' | 'sending' | 'sent' | 'failed' | 'skipped' | 'uncertain' | 'audit_failed'
  sentAt?: Date
  error?: string
}

const schema = new Schema<EditingReminder>({
  requestKey: { type: String, required: true },
  jobId: { type: String, required: true, index: true },
  cycleId: { type: String, required: true, index: true },
  submissionId: { type: String, required: true, index: true },
  actor: { type: String, required: true },
  status: { type: String, required: true, enum: ['pending', 'sending', 'sent', 'failed', 'skipped', 'uncertain', 'audit_failed'] },
  sentAt: Date,
  error: String
}, { timestamps: true })
schema.index({ requestKey: 1, submissionId: 1 }, { unique: true })
schema.index({ cycleId: 1, submissionId: 1, status: 1 })
export const EditingReminderModel: mongoose.Model<EditingReminder> = (mongoose.models.EditingReminder as mongoose.Model<EditingReminder>) || mongoose.model<EditingReminder>('EditingReminder', schema)
