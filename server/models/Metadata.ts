import mongoose, { Schema } from 'mongoose'

export interface Metadata {
  cycleId?: string
  type: 'project' | 'form' | 'label' | 'team'
  externalId: string
  name: string
  data: any
  syncedAt?: Date
  createdAt?: Date
  updatedAt?: Date
}

const metadataSchema = new Schema<Metadata>({
  cycleId: { type: String, index: true },
  type: { type: String, required: true, index: true },
  externalId: { type: String, required: true },
  name: { type: String, required: true },
  data: { type: Schema.Types.Mixed, default: {} },
  syncedAt: Date
}, { timestamps: true, autoIndex: false })

metadataSchema.index({ type: 1, externalId: 1 }, { unique: true })

export const MetadataModel: mongoose.Model<Metadata> = (mongoose.models.Metadata as mongoose.Model<Metadata>) || mongoose.model<Metadata>('Metadata', metadataSchema)
