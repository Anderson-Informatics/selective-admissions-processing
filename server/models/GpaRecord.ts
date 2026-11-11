import mongoose, { Schema } from 'mongoose'

export interface DpscdSnapshot {
  cumulativeGpa?: number
  quartersAvailable?: number
  gpaStatus?: string
  quartersByGrade?: Record<string, number>
}

export interface DpscdGpa {
  snapshots?: { r1?: DpscdSnapshot, all?: DpscdSnapshot }
  selectedSnapshot?: 'r1' | 'all'
  selectionIssue?: string
  selectedRound?: string
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
  resolvedCumulativeGpa?: number | null
  resolvedSource?: 'recording' | 'dpscd' | 'optIn' | 'partial' | null
  gpaMultiplier?: number | null
  gpaBonusEligible?: boolean
  gpaBonus?: number | null
  gpaScore?: number | null
  createdAt?: Date
  updatedAt?: Date
}

const snapshotSchema = new Schema<DpscdSnapshot>({
  cumulativeGpa: Number,
  quartersAvailable: Number,
  gpaStatus: String,
  quartersByGrade: { type: Schema.Types.Mixed }
}, { _id: false })

const gpaRecordSchema = new Schema<GpaRecord>({
  cycleId: { type: String, required: true, index: true },
  submissionId: { type: String, required: true },
  submissionIdInt: { type: Number, index: true, sparse: true },
  dpscd: {
    snapshots: { r1: snapshotSchema, all: snapshotSchema },
    selectedSnapshot: String,
    selectionIssue: String,
    selectedRound: String,
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
  },
  resolvedCumulativeGpa: Number,
  resolvedSource: String,
  gpaMultiplier: { type: Number, default: null },
  gpaBonusEligible: Boolean,
  gpaBonus: { type: Number, default: null },
  gpaScore: { type: Number, default: null }
}, { timestamps: true })

gpaRecordSchema.index({ cycleId: 1, submissionId: 1 }, { unique: true })

export const GpaRecordModel: mongoose.Model<GpaRecord> = (mongoose.models.GpaRecord as mongoose.Model<GpaRecord>) || mongoose.model<GpaRecord>('GpaRecord', gpaRecordSchema)
