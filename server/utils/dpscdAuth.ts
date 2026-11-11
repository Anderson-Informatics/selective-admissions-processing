import type { H3Event } from 'h3'
import { requireAuth } from './auth'
import { requireDataKey } from './dataApi'

export const DPSCD_API_ACTOR = 'service:dpscd-data-api'

export async function requireDpscdAccess(event: H3Event): Promise<{ email: string, apiKey: boolean }> {
  if (getHeader(event, 'authorization') !== undefined) {
    requireDataKey(event)
    return { email: DPSCD_API_ACTOR, apiKey: true }
  }
  const user = await requireAuth(event)
  return { email: user.email, apiKey: false }
}
