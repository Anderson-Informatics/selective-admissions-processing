import mongoose, { Schema } from 'mongoose'

export type HSPTMatchStatus = 'unlinked' | 'linked' | 'rejected'

export interface HSPTResult {
  cycleId: string
  sourceId: string
  resultId?: number
  hpid: string
  testCenter: string
  batch: string
  lastName: string
  firstName: string
  gender: string
  age: string
  birth: string
  birthDate?: Date
  optCd: string
  rdrs: number
  mtrs: number
  lnrs: number
  oprs: number
  reading: number
  math: number
  language: number
  science: number
  overall: number
  sourceFile: string
  linkedSubmissionId?: string
  matchType?: string
  matchScore?: number
  status: HSPTMatchStatus
  createdAt?: Date
  updatedAt?: Date
}

const hsptResultSchema = new Schema<HSPTResult>({
  cycleId: { type: String, required: true, index: true },
  sourceId: { type: String, required: true, index: true },
  resultId: { type: Number, index: true },
  hpid: { type: String, required: true, index: true },
  testCenter: { type: String, required: true, index: true },
  batch: { type: String, required: true, index: true },
  lastName: { type: String, required: true, index: true },
  firstName: { type: String, required: true, index: true },
  gender: String,
  age: String,
  birth: { type: String, index: true },
  birthDate: { type: Date, index: true, sparse: true },
  optCd: { type: String, index: true },
  rdrs: { type: Number, default: 0 },
  mtrs: { type: Number, default: 0 },
  lnrs: { type: Number, default: 0 },
  oprs: { type: Number, default: 0 },
  reading: { type: Number, default: 0 },
  math: { type: Number, default: 0 },
  language: { type: Number, default: 0 },
  science: { type: Number, default: 0 },
  overall: { type: Number, default: 0 },
  sourceFile: { type: String, required: true },
  linkedSubmissionId: { type: String, index: true, sparse: true },
  matchType: String,
  matchScore: Number,
  status: { type: String, default: 'unlinked', index: true }
}, { timestamps: true })

hsptResultSchema.index({ cycleId: 1, sourceId: 1 }, { unique: true })

export const HSPTResultModel: mongoose.Model<HSPTResult> = (mongoose.models.HSPTResult as mongoose.Model<HSPTResult>) || mongoose.model<HSPTResult>('HSPTResult', hsptResultSchema)
