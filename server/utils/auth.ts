import { useSession } from 'h3'
import type { H3Event } from 'h3'

export interface AuthUser {
  email: string
  password?: string
}

let _authUsers: AuthUser[] | null = null

function parseAuthUsers(value: unknown): AuthUser[] {
  if (!value) return []
  try {
    const users = typeof value === 'string' ? JSON.parse(value) : value
    if (!Array.isArray(users)) {
      throw new Error('NUXT_AUTH_USERS must be a JSON array')
    }
    for (const user of users) {
      if (typeof user.email !== 'string' || typeof user.password !== 'string') {
        throw new Error('Each entry in NUXT_AUTH_USERS must have email and password strings')
      }
    }
    return users
  } catch (err: any) {
    throw new Error(`Failed to parse NUXT_AUTH_USERS: ${err.message}`)
  }
}

export function getAuthUsers(): AuthUser[] {
  if (!_authUsers) {
    _authUsers = parseAuthUsers(useRuntimeConfig().authUsers)
  }
  return _authUsers
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

export async function getAuthUser(event: H3Event): Promise<Pick<AuthUser, 'email'> | null> {
  const session = await useSession(event, getSessionConfig())
  const email = session.data.email
  return email ? { email: email as string } : null
}

export async function requireAuth(event: H3Event): Promise<Pick<AuthUser, 'email'>> {
  const user = await getAuthUser(event)
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
  return user
}

export async function setAuthSession(event: H3Event, user: Pick<AuthUser, 'email'>) {
  const session = await useSession(event, getSessionConfig())
  await session.update({ email: user.email })
}

export async function clearAuthSession(event: H3Event) {
  const session = await useSession(event, getSessionConfig())
  await session.clear()
}
