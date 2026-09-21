import mongoose, { Schema } from 'mongoose'

export interface ReviewCompletionEntry {
  stageId: string
  name: string
  order: number
  role: 'initial' | 'work' | 'hold' | 'final'
  required: boolean
  status: string
  complete: boolean
}

export interface Submission {
  cycleId: string
  applicationId: string
  projectId: string
  submissionId: string
  submissionIdInt?: number
  status: string
  createdAt?: Date
  completedAt?: Date
  submissionDate?: Date
  roundKey?: string
  roundName?: string
  roundStatus?: 'matched' | 'outside_configured_ranges' | 'missing_submission_date'
  createdBy?: string
  entryIds: string[]
  stageNames: string[]
  mappedFields: Record<string, unknown>
  isMapped: boolean
  currentStageId?: string
  currentStageName?: string
  labelIds?: string[]
  reviewCompletion: ReviewCompletionEntry[]
  hsptResultId?: string
  hsptMatchType?: string
  geocode?: {
    status?: 'ok' | 'failed' | 'no_address' | ''
    lat?: number
    lng?: number
    address?: string
    formattedAddress?: string
    error?: string
    geocodedAt?: Date
  }
  catchment?: {
    marygrove?: 'Primary' | 'Secondary' | 'None'
    checkedAt?: Date
  }
  createdAtTimestamp?: Date
  updatedAtTimestamp?: Date
}

const submissionSchema = new Schema<Submission>({
  cycleId: { type: String, required: true, index: true },
  applicationId: { type: String, required: true, index: true },
  projectId: { type: String, required: true, index: true },
  submissionId: { type: String, required: true, unique: true },
  submissionIdInt: { type: Number, index: true, sparse: true },
  status: { type: String, default: '' },
  createdAt: Date,
  completedAt: Date,
  submissionDate: Date,
  roundKey: { type: String, index: true },
  roundName: String,
  roundStatus: { type: String, index: true },
  createdBy: String,
  entryIds: { type: [String], default: [] },
  stageNames: { type: [String], default: [] },
  mappedFields: { type: Schema.Types.Mixed, default: {} },
  isMapped: { type: Boolean, default: false },
  currentStageId: String,
  currentStageName: { type: String, index: true },
  labelIds: { type: [String], default: undefined, index: true },
  reviewCompletion: {
    type: [{
      stageId: { type: String, required: true },
      name: { type: String, required: true },
      order: { type: Number, required: true },
      role: { type: String, enum: ['initial', 'work', 'hold', 'final'], required: true },
      required: { type: Boolean, required: true },
      status: { type: String, required: true },
      complete: { type: Boolean, required: true }
    }],
    default: []
  },
  hsptResultId: { type: String, index: true, sparse: true },
  hsptMatchType: { type: String, index: true },
  geocode: {
    status: { type: String, default: '' },
    lat: Number,
    lng: Number,
    address: String,
    formattedAddress: String,
    error: String,
    geocodedAt: Date
  },
  catchment: {
    marygrove: { type: String, index: true },
    checkedAt: Date
  }
}, { timestamps: true })

export const SubmissionModel: mongoose.Model<Submission> = (mongoose.models.Submission as mongoose.Model<Submission>) || mongoose.model<Submission>('Submission', submissionSchema)
