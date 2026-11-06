import mongoose, { Schema } from 'mongoose'

export interface CycleRound {
  key: string
  name: string
  order: number
  startDate: Date
  endDate: Date
  active: boolean
}

export interface Cycle {
  year: string
  name: string
  active: boolean
  startDate?: Date
  endDate?: Date
  scoreWeights?: Record<string, number>
  hsptResultIdCounter?: number
  createdAt?: Date
  updatedAt?: Date
}

const cycleSchema = new Schema<Cycle>({
  year: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  active: { type: Boolean, default: false },
  startDate: Date,
  endDate: Date,
  scoreWeights: { type: Schema.Types.Mixed, default: {} },
  hsptResultIdCounter: { type: Number, default: 1000 }
}, { timestamps: true })

export const CycleModel: mongoose.Model<Cycle> = (mongoose.models.Cycle as mongoose.Model<Cycle>) || mongoose.model<Cycle>('Cycle', cycleSchema)
