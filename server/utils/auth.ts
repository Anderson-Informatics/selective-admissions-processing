import { useSession } from 'h3'
import type { H3Event } from 'h3'
import type { UserRole } from '../models/User'

export interface AuthUser {
  userId: string
  email: string
  role: UserRole
}

interface SessionData {
  userId?: string
  email?: string
  role?: UserRole
}

export function getSessionConfig() {
  const secret = useRuntimeConfig().authSecret
  if (!secret) {
    throw new Error('NUXT_AUTH_SECRET is required for authentication')
  }
  return {
    name: 'auth-session',
    password: secret,
    maxAge: 60 * 60 * 24 * 7, // 7 days
    cookie: {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: process.env.NODE_ENV === 'production',
      path: '/'
    }
  }
}

export async function getAuthUser(event: H3Event): Promise<AuthUser | null> {
  const session = await useSession<SessionData>(event, getSessionConfig())
  const { userId, email, role } = session.data
  if (!userId || !email || !role) return null
  return { userId, email, role }
}

export async function requireAuth(event: H3Event): Promise<AuthUser> {
  const user = await getAuthUser(event)
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
  return user
}

export async function requireRole(event: H3Event, role: UserRole): Promise<AuthUser> {
  const user = await requireAuth(event)
  if (user.role !== role) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }
  return user
}

export async function setAuthSession(event: H3Event, user: AuthUser) {
  const session = await useSession<SessionData>(event, getSessionConfig())
  await session.update({ userId: user.userId, email: user.email, role: user.role })
}

export async function clearAuthSession(event: H3Event) {
  const session = await useSession(event, getSessionConfig())
  await session.clear()
}
