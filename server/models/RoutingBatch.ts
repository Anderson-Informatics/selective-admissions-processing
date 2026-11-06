import mongoose, { Schema } from 'mongoose'
import type { RoutingExecutionResult } from '../utils/routingExecutor'

export interface RoutingBatch {
  jobId: string
  index: number
  submissionIds: string[]
  status: 'pending' | 'running' | 'completed'
  result?: RoutingExecutionResult
}

const schema = new Schema<RoutingBatch>({
  jobId: { type: String, required: true },
  index: { type: Number, required: true },
  submissionIds: [String],
  status: { type: String, default: 'pending' },
  result: Schema.Types.Mixed
}, { timestamps: true })

schema.index({ jobId: 1, index: 1 }, { unique: true })

export const RoutingBatchModel: mongoose.Model<RoutingBatch> = (mongoose.models.RoutingBatch as mongoose.Model<RoutingBatch>) || mongoose.model<RoutingBatch>('RoutingBatch', schema)
