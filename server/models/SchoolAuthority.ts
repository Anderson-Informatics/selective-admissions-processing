import mongoose, { Schema } from 'mongoose'

export interface SchoolAuthority {
  cycleId: string
  applicationId: string
  schoolId: string
  userId: string
  version: number
}
const schema = new Schema<SchoolAuthority>({
  cycleId: { type: String, required: true },
  applicationId: { type: String, default: '' },
  schoolId: { type: String, required: true },
  userId: { type: String, required: true },
  version: { type: Number, default: 1 }
}, { timestamps: true })
schema.index({ cycleId: 1, applicationId: 1, schoolId: 1 }, { unique: true })
export const SchoolAuthorityModel: mongoose.Model<SchoolAuthority> = (mongoose.models.SchoolAuthority as mongoose.Model<SchoolAuthority>) || mongoose.model<SchoolAuthority>('SchoolAuthority', schema)
