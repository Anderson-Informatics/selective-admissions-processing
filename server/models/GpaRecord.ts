import mongoose, { Schema } from 'mongoose'

export interface DpscdGpa {
  studentNumber?: number
  quartersAvailable?: number
  cumulativeGpa?: number
  gpaStatus?: string
  yearEnd?: number
  gradeLevel?: number
  middleSchoolNumber?: number
  projectName?: string
  submissionStatus?: string
  stageName?: string
  acceptingHighSchool?: string
  acceptingHighSchoolNumber?: number
  completedAt?: Date
  importJobId?: string
  importedAt?: Date
  extra?: Record<string, unknown>
}

export interface OptInGpa {
  studentName: string
  firstName: string
  lastName: string
  dob?: Date
  enrolledMinTerms?: 'yes' | 'no' | ''
  enrolledMinTermsFlag?: boolean
  termsEnrolled?: number
  cumulativeGpa?: number
  schoolName: string
  sourceFile: string
  uploadId?: string
  importedAt?: Date
}

export interface GpaRecord {
  cycleId: string
  submissionId: string
  submissionIdInt?: number
  dpscd?: DpscdGpa
  optIn?: OptInGpa
  createdAt?: Date
  updatedAt?: Date
}

const gpaRecordSchema = new Schema<GpaRecord>({
  cycleId: { type: String, required: true, index: true },
  submissionId: { type: String, required: true },
  submissionIdInt: { type: Number, index: true, sparse: true },
  dpscd: {
    studentNumber: Number,
    quartersAvailable: Number,
    cumulativeGpa: Number,
    gpaStatus: String,
    yearEnd: Number,
    gradeLevel: Number,
    middleSchoolNumber: Number,
    projectName: String,
    submissionStatus: String,
    stageName: String,
    acceptingHighSchool: String,
    acceptingHighSchoolNumber: Number,
    completedAt: Date,
    importJobId: String,
    importedAt: Date,
    extra: { type: Schema.Types.Mixed }
  },
  optIn: {
    studentName: String,
    firstName: String,
    lastName: String,
    dob: Date,
    enrolledMinTerms: String,
    enrolledMinTermsFlag: Boolean,
    termsEnrolled: Number,
    cumulativeGpa: Number,
    schoolName: String,
    sourceFile: String,
    uploadId: String,
    importedAt: Date
  }
}, { timestamps: true })

gpaRecordSchema.index({ cycleId: 1, submissionId: 1 }, { unique: true })

export const GpaRecordModel: mongoose.Model<GpaRecord> = (mongoose.models.GpaRecord as mongoose.Model<GpaRecord>) || mongoose.model<GpaRecord>('GpaRecord', gpaRecordSchema)
