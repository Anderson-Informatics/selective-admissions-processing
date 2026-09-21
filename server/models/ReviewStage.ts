import mongoose, { Schema } from 'mongoose'
import type { RoutingConfig } from '../utils/routingConfig'

export type ReviewStageRole = 'initial' | 'work' | 'hold' | 'final'

export interface ReviewStage {
  cycleId: string
  applicationId: string
  projectId: string
  stageId: string
  name: string
  type: string
  formId?: string
  order: number
  role: ReviewStageRole
  routing: RoutingConfig
  routingDraft?: RoutingConfig
  routingDraftUpdatedAt?: Date
  routingPublishedAt?: Date
  routingPublishedBy?: string
  routingDraftVersion?: number
  createdAt?: Date
  updatedAt?: Date
}

const reviewStageSchema = new Schema<ReviewStage>({
  cycleId: { type: String, required: true, index: true },
  applicationId: { type: String, required: true, index: true },
  projectId: { type: String, required: true },
  stageId: { type: String, required: true },
  name: { type: String, required: true },
  type: { type: String, default: 'custom_review' },
  formId: String,
  order: { type: Number, default: 0 },
  role: { type: String, enum: ['initial', 'work', 'hold', 'final'], default: 'work' },
  routing: {
    enabled: { type: Boolean, default: false },
    requiredWhen: { type: Schema.Types.Mixed },
    allowedStatuses: { type: [String], default: undefined },
    statusRules: { type: [Schema.Types.Mixed], default: [] },
    statusLabels: { type: Schema.Types.Mixed, default: undefined },
    outcomeRules: { type: [Schema.Types.Mixed], default: [] },
    entryActions: { type: [Schema.Types.Mixed], default: [] },
    exitActions: { type: [Schema.Types.Mixed], default: [] }
  },
  routingDraft: { type: Schema.Types.Mixed },
  routingDraftUpdatedAt: Date,
  routingPublishedAt: Date,
  routingPublishedBy: String,
  routingDraftVersion: { type: Number, default: 0 }
}, { timestamps: true })

reviewStageSchema.index({ cycleId: 1, applicationId: 1, stageId: 1 }, { unique: true })

export const ReviewStageModel: mongoose.Model<ReviewStage> = (mongoose.models.ReviewStage as mongoose.Model<ReviewStage>) || mongoose.model<ReviewStage>('ReviewStage', reviewStageSchema)
