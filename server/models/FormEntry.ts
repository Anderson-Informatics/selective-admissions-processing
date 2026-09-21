import mongoose, { Schema } from 'mongoose'

export interface FormEntry {
  cycleId: string
  applicationId: string
  projectId: string
  submissionId: string
  entryId: string
  formId: string
  formType: string
  status: string
  completedAt?: Date
  createdBy?: string
  createdAt?: Date
  fieldData: any[]
  mappedData: any
  isMapped: boolean
  createdAtTimestamp?: Date
  updatedAtTimestamp?: Date
}

const formEntrySchema = new Schema<FormEntry>({
  cycleId: { type: String, required: true, index: true },
  applicationId: { type: String, required: true, index: true },
  projectId: { type: String, required: true, index: true },
  submissionId: { type: String, required: true, index: true },
  entryId: { type: String, required: true, unique: true },
  formId: { type: String, required: true, index: true },
  formType: { type: String, default: 'initial' },
  status: { type: String, default: '' },
  completedAt: Date,
  createdBy: String,
  createdAt: Date,
  fieldData: { type: [Schema.Types.Mixed], default: [] },
  mappedData: { type: Schema.Types.Mixed, default: {} },
  isMapped: { type: Boolean, default: false }
}, { timestamps: true })

formEntrySchema.index({ cycleId: 1, applicationId: 1, formId: 1 })
formEntrySchema.index({ cycleId: 1, createdAt: 1, _id: 1 })

export const FormEntryModel: mongoose.Model<FormEntry> = (mongoose.models.FormEntry as mongoose.Model<FormEntry>) || mongoose.model<FormEntry>('FormEntry', formEntrySchema)
