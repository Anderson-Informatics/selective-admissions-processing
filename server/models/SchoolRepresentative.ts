import mongoose, { Schema } from 'mongoose'

export interface SchoolRepresentative {
  userId: string
  schoolIds: string[]
  active: boolean
}
const schema = new Schema<SchoolRepresentative>({
  userId: { type: String, required: true, unique: true },
  schoolIds: { type: [String], default: [] },
  active: { type: Boolean, default: true }
}, { timestamps: true })
export const SchoolRepresentativeModel: mongoose.Model<SchoolRepresentative> = (mongoose.models.SchoolRepresentative as mongoose.Model<SchoolRepresentative>) || mongoose.model<SchoolRepresentative>('SchoolRepresentative', schema)
