import mongoose, { Schema } from 'mongoose'
import type { DecisionResult } from '../utils/decisionScoring'
import type { ReviewCompletionResult, RoutingDecision } from '../utils/routingEvaluator'

export interface ScoreRecord {
  cycleId: string
  applicationId: string
  submissionId: string
  hsptTaken: boolean
  gpaRecorded: boolean
  essayScored: boolean
  gpa?: {
    raw?: number | null
    source?: string | null
    multiplier?: number
    bonus?: number
    score?: number | null
  }
  exam?: {
    reading?: number
    math?: number
    language?: number
    science?: number
    overall?: number
    hsptResultId?: string
    matchType?: string
  }
  essay?: {
    score?: number | null
    reviewCount?: number
  }
  dpscdBonus: number
  marygroveBonus: number
  marygroveCatchment?: string
  totalAppScore: number | null
  totalMarygroveScore: number | null
  placementPathway?: 'score' | 'decision' | null
  supportingComponents?: string[]
  inputsComplete?: boolean
  missingInputs?: string[]
  decision?: DecisionResult | null
  decisionConfigSnapshot?: Record<string, unknown> | null
  configFingerprint?: string | null
  routingEvaluation?: { completion: ReviewCompletionResult['reviewCompletion'], recommendation: RoutingDecision } | null
  percentiles?: Record<string, number | null>
  compiledAt?: Date
  compileJobId?: string
  internalFormSyncedAt?: Date
  internalFormSyncStatus?: 'pending' | 'synced' | 'unchanged' | 'failed' | 'skipped'
  internalFormSyncError?: string
  createdAt?: Date
  updatedAt?: Date
}

const scoreRecordSchema = new Schema<ScoreRecord>({
  cycleId: { type: String, required: true, index: true },
  applicationId: { type: String, required: true, index: true },
  submissionId: { type: String, required: true },
  hsptTaken: { type: Boolean, default: false },
  gpaRecorded: { type: Boolean, default: false },
  essayScored: { type: Boolean, default: false },
  gpa: {
    raw: { type: Number, default: null },
    source: { type: String, default: null },
    multiplier: Number,
    bonus: Number,
    score: Number
  },
  exam: {
    reading: Number,
    math: Number,
    language: Number,
    science: Number,
    overall: Number,
    hsptResultId: String,
    matchType: String
  },
  essay: {
    score: { type: Number, default: null },
    reviewCount: Number
  },
  dpscdBonus: { type: Number, default: 0 },
  marygroveBonus: { type: Number, default: 0 },
  marygroveCatchment: String,
  placementPathway: { type: String, default: null },
  supportingComponents: [String],
  inputsComplete: Boolean,
  missingInputs: [String],
  decision: Schema.Types.Mixed,
  decisionConfigSnapshot: Schema.Types.Mixed,
  configFingerprint: String,
  routingEvaluation: Schema.Types.Mixed,
  totalAppScore: { type: Number, default: 0 },
  totalMarygroveScore: { type: Number, default: 0 },
  percentiles: { type: Schema.Types.Mixed },
  compiledAt: Date,
  compileJobId: String,
  internalFormSyncedAt: Date,
  internalFormSyncStatus: { type: String, default: 'pending' },
  internalFormSyncError: String
}, { timestamps: true })

scoreRecordSchema.index({ cycleId: 1, applicationId: 1, submissionId: 1 }, { unique: true })

export const ScoreRecordModel: mongoose.Model<ScoreRecord> = (mongoose.models.ScoreRecord as mongoose.Model<ScoreRecord>) || mongoose.model<ScoreRecord>('ScoreRecord', scoreRecordSchema)
