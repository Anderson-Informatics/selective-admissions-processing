import mongoose, { Schema } from 'mongoose'

export interface FieldMapping {
  cycleId: string
  formId: string
  fieldId: string
  label: string
  canonicalName: string
  transform?: string
  updatedAt?: Date
  createdAt?: Date
}

const fieldMappingSchema = new Schema<FieldMapping>({
  cycleId: { type: String, required: true, index: true },
  formId: { type: String, required: true, index: true },
  fieldId: { type: String, required: true },
  label: { type: String, required: true },
  canonicalName: { type: String, default: '' },
  transform: { type: String, default: '' }
}, { timestamps: true })

fieldMappingSchema.index({ cycleId: 1, formId: 1, fieldId: 1 }, { unique: true })

export const FieldMappingModel: mongoose.Model<FieldMapping> = (mongoose.models.FieldMapping as mongoose.Model<FieldMapping>) || mongoose.model<FieldMapping>('FieldMapping', fieldMappingSchema)
