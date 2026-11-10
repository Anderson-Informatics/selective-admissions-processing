import mongoose, { Schema } from 'mongoose'

export type UserRole = 'site_admin' | 'central_admin'

export interface User {
  email: string
  passwordHash: string
  role: UserRole
  status: 'active' | 'disabled'
  passwordResetRequestedAt?: Date
  failedLoginAttempts: number
  lockedUntil?: Date
  lastLoginAt?: Date
  createdAt?: Date
  updatedAt?: Date
}

const userSchema = new Schema<User>({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['site_admin', 'central_admin'], required: true, default: 'central_admin' },
  status: { type: String, enum: ['active', 'disabled'], required: true, default: 'active' },
  passwordResetRequestedAt: Date,
  failedLoginAttempts: { type: Number, required: true, default: 0 },
  lockedUntil: Date,
  lastLoginAt: Date
}, { timestamps: true })

export const UserModel: mongoose.Model<User> = (mongoose.models.User as mongoose.Model<User>) || mongoose.model<User>('User', userSchema)
