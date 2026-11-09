import mongoose, { Schema } from 'mongoose'
import type { ScheduleInput, ScheduledJobType } from '../../shared/jobSchedule'

export interface JobSchedule extends ScheduleInput {
  eligibleAfter: Date
  createdBy: string
  updatedBy: string
}
const schema = new Schema<JobSchedule>({
  name: { type: String, required: true },
  time: { type: String, required: true },
  enabled: { type: Boolean, default: false, index: true },
  steps: { type: [String], required: true },
  dryRun: { type: Boolean, default: true },
  acknowledged: { type: Boolean, default: false },
  revision: { type: Number, default: 0 },
  eligibleAfter: { type: Date, required: true },
  createdBy: { type: String, required: true },
  updatedBy: { type: String, required: true }
}, { timestamps: true })
export const JobScheduleModel: mongoose.Model<JobSchedule> = (mongoose.models.JobSchedule as mongoose.Model<JobSchedule>) || mongoose.model<JobSchedule>('JobSchedule', schema)

export interface ScheduleRun {
  scheduleId: string
  name: string
  revision: number
  localDate: string
  dueAt: Date
  cycleId?: string
  steps: ScheduledJobType[]
  dryRun: boolean
  actor: string
  status: 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'skipped'
  stepIndex: number
  partial: boolean
  message?: string
  startedAt?: Date
  completedAt?: Date
}
const runSchema = new Schema<ScheduleRun>({
  scheduleId: { type: String, required: true }, name: String, revision: Number,
  localDate: { type: String, required: true }, dueAt: { type: Date, required: true },
  cycleId: { type: String, index: true }, steps: [String], dryRun: Boolean, actor: String,
  status: { type: String, default: 'queued', index: true }, stepIndex: { type: Number, default: 0 }, partial: { type: Boolean, default: false },
  message: String, startedAt: Date, completedAt: Date
}, { timestamps: true })
runSchema.index({ scheduleId: 1, localDate: 1 }, { unique: true })
runSchema.index({ cycleId: 1, status: 1, dueAt: 1, _id: 1 })
export const ScheduleRunModel: mongoose.Model<ScheduleRun> = (mongoose.models.ScheduleRun as mongoose.Model<ScheduleRun>) || mongoose.model<ScheduleRun>('ScheduleRun', runSchema)

export interface ScheduleCycle {
  cycleId: string
  runId?: string
  hold?: string
  releasedBy?: string
  releasedAt?: Date
}
const cycleSchema = new Schema<ScheduleCycle>({ cycleId: { type: String, unique: true, required: true }, runId: String, hold: String, releasedBy: String, releasedAt: Date }, { timestamps: true })
export const ScheduleCycleModel: mongoose.Model<ScheduleCycle> = (mongoose.models.ScheduleCycle as mongoose.Model<ScheduleCycle>) || mongoose.model<ScheduleCycle>('ScheduleCycle', cycleSchema)
