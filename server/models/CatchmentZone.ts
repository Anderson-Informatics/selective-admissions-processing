import mongoose, { Schema } from 'mongoose'

export interface CatchmentZone {
  name: string
  type: string
  schoolId?: number
  geometry: {
    type: string
    coordinates: number[][][]
  }
  createdAt?: Date
  updatedAt?: Date
}

const catchmentZoneSchema = new Schema<CatchmentZone>({
  name: { type: String, required: true, index: true },
  type: { type: String, required: true },
  schoolId: Number,
  geometry: { type: Schema.Types.Mixed, required: true }
}, { timestamps: true, collection: 'catchmentzones' })

catchmentZoneSchema.index({ geometry: '2dsphere' })

export const CatchmentZoneModel: mongoose.Model<CatchmentZone> = (mongoose.models.CatchmentZone as mongoose.Model<CatchmentZone>) || mongoose.model<CatchmentZone>('CatchmentZone', catchmentZoneSchema)
