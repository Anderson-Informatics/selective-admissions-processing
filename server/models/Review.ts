import mongoose, { Schema } from 'mongoose'

export interface Review {
  cycleId: string
  applicationId: string
  submissionId: string
  stageId: string
  stageName: string
  stageOrder: number
  requiredForProgress: boolean
  reviewerId?: string
  score?: number
  isAssigned?: boolean
  entryId: string
  formId: string
  status: string
  completedAt?: Date
  createdBy?: string
  createdAt?: Date
  fieldData: unknown[]
  mappedData: Record<string, unknown>
  isMapped: boolean
  createdAtTimestamp?: Date
  updatedAtTimestamp?: Date
}

const reviewSchema = new Schema<Review>({
  cycleId: { type: String, required: true, index: true },
  applicationId: { type: String, required: true, index: true },
  submissionId: { type: String, required: true, index: true },
  stageId: { type: String, required: true, index: true },
  stageName: { type: String, default: '' },
  stageOrder: { type: Number, default: 0 },
  requiredForProgress: { type: Boolean, default: true },
  reviewerId: String,
  score: Number,
  isAssigned: Boolean,
  entryId: { type: String, required: true, unique: true },
  formId: { type: String, required: true, index: true },
  status: { type: String, default: '' },
  completedAt: Date,
  createdBy: String,
  createdAt: Date,
  fieldData: { type: [Schema.Types.Mixed], default: [] },
  mappedData: { type: Schema.Types.Mixed, default: {} },
  isMapped: { type: Boolean, default: false }
}, { timestamps: true })

reviewSchema.index({ cycleId: 1, submissionId: 1 })
reviewSchema.index({ cycleId: 1, applicationId: 1, stageId: 1, status: 1 })
reviewSchema.index({ cycleId: 1, formId: 1, stageId: 1 })
reviewSchema.index({ cycleId: 1, createdAt: 1, _id: 1 })

export const ReviewModel: mongoose.Model<Review> = (mongoose.models.Review as mongoose.Model<Review>) || mongoose.model<Review>('Review', reviewSchema)
