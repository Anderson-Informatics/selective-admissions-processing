import mongoose, { Schema } from 'mongoose'

export interface AuditLog {
  action: string
  actor: string
  cycleId?: string
  applicationId?: string
  entityType: string
  entityId: string
  changes: Array<{ path: string, before?: unknown, after?: unknown }>
  beforeHash?: string
  afterHash?: string
  createdAt?: Date
}

const auditLogSchema = new Schema<AuditLog>({
  action: { type: String, required: true, index: true },
  actor: { type: String, required: true },
  cycleId: { type: String, index: true },
  applicationId: { type: String, index: true },
  entityType: { type: String, required: true },
  entityId: { type: String, required: true, index: true },
  changes: {
    type: [{
      path: { type: String, required: true },
      before: { type: Schema.Types.Mixed },
      after: { type: Schema.Types.Mixed }
    }],
    default: []
  },
  beforeHash: String,
  afterHash: String
}, { timestamps: { createdAt: true, updatedAt: false } })

export const AuditLogModel: mongoose.Model<AuditLog> = (mongoose.models.AuditLog as mongoose.Model<AuditLog>) || mongoose.model<AuditLog>('AuditLog', auditLogSchema)
