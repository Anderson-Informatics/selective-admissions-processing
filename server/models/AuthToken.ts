import mongoose, { Schema } from 'mongoose'

export type AuthTokenType = 'invite' | 'reset'

export interface AuthToken {
  tokenHash: string
  type: AuthTokenType
  email: string
  role?: 'site_admin' | 'central_admin'
  userId?: string
  createdBy: string
  expiresAt: Date
  consumedAt?: Date
  createdAt?: Date
}

const authTokenSchema = new Schema<AuthToken>({
  tokenHash: { type: String, required: true, unique: true },
  type: { type: String, enum: ['invite', 'reset'], required: true, index: true },
  email: { type: String, required: true, lowercase: true, trim: true, index: true },
  role: { type: String, enum: ['site_admin', 'central_admin'] },
  userId: { type: String, index: true },
  createdBy: { type: String, required: true },
  expiresAt: { type: Date, required: true, index: true },
  consumedAt: Date
}, { timestamps: { createdAt: true, updatedAt: false } })

export const AuthTokenModel: mongoose.Model<AuthToken> = (mongoose.models.AuthToken as mongoose.Model<AuthToken>) || mongoose.model<AuthToken>('AuthToken', authTokenSchema)
