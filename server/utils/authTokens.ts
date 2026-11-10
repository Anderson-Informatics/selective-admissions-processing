import { createHash, randomBytes } from 'node:crypto'
import { AuthTokenModel, type AuthToken, type AuthTokenType } from '../models/AuthToken'
import type { UserRole } from '../models/User'

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export async function createAuthToken(input: {
  type: AuthTokenType
  email: string
  role?: UserRole
  userId?: string
  createdBy: string
  ttlHours?: number
}): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  await AuthTokenModel.create({
    tokenHash: hashToken(token),
    type: input.type,
    email: input.email,
    role: input.role,
    userId: input.userId,
    createdBy: input.createdBy,
    expiresAt: new Date(Date.now() + (input.ttlHours ?? 72) * 60 * 60 * 1000)
  })
  return token
}

export async function findValidToken(token: unknown, type: AuthTokenType): Promise<AuthToken & { _id: unknown } | null> {
  if (typeof token !== 'string' || !token) return null
  return AuthTokenModel.findOne({
    tokenHash: hashToken(token),
    type,
    consumedAt: { $exists: false },
    expiresAt: { $gt: new Date() }
  }).lean() as unknown as Promise<AuthToken & { _id: unknown } | null>
}
