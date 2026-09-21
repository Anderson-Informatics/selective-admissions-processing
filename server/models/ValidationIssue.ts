import mongoose, { Schema } from 'mongoose'

export type ValidationIssueSeverity = 'error' | 'warning' | 'info'
export type ValidationIssueStatus = 'open' | 'resolved'
export type ValidationIssueResolution = 'auto' | 'override'

export interface ValidationIssue {
  cycleId: string
  applicationId?: string
  submissionId: string
  type: string
  severity: ValidationIssueSeverity
  field?: string
  message: string
  status: ValidationIssueStatus
  resolution?: ValidationIssueResolution
  resolvedAt?: Date
  resolvedBy?: string
  createdAt?: Date
  updatedAt?: Date
}

const validationIssueSchema = new Schema<ValidationIssue>({
  cycleId: { type: String, required: true, index: true },
  applicationId: { type: String, index: true },
  submissionId: { type: String, required: true, index: true },
  type: { type: String, required: true, index: true },
  severity: { type: String, required: true, default: 'warning' },
  field: { type: String, index: true },
  message: { type: String, required: true },
  status: { type: String, required: true, default: 'open', index: true },
  resolution: { type: String, index: true },
  resolvedAt: Date,
  resolvedBy: String
}, { timestamps: true })

validationIssueSchema.index({ cycleId: 1, status: 1 })
validationIssueSchema.index({ cycleId: 1, type: 1, status: 1 })
validationIssueSchema.index({ cycleId: 1, submissionId: 1, type: 1, field: 1 }, { unique: true })

export const ValidationIssueModel: mongoose.Model<ValidationIssue> = (mongoose.models.ValidationIssue as mongoose.Model<ValidationIssue>) || mongoose.model<ValidationIssue>('ValidationIssue', validationIssueSchema)
