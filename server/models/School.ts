import mongoose, { Schema } from 'mongoose'

export interface School {
  name: string
  aliases: string[]
  matchKeys: string[]
  active: boolean
}

const schema = new Schema<School>({
  name: { type: String, required: true },
  aliases: { type: [String], default: [] },
  matchKeys: { type: [String], required: true },
  active: { type: Boolean, default: true }
}, { timestamps: true })
schema.index({ matchKeys: 1 }, { unique: true })
export const SchoolModel: mongoose.Model<School> = (mongoose.models.School as mongoose.Model<School>) || mongoose.model<School>('School', schema)
