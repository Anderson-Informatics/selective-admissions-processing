import { z } from 'zod'
import { loadIepRoster } from '../../utils/iepRosteringRun'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const parsed = z.object({ cycleId: z.string().regex(/^[a-f\d]{24}$/i), sessionLabelId: z.string().trim().min(1).optional() }).safeParse(getQuery(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'A valid cycleId and optional sessionLabelId are required.' })
  await connectDb()
  const result = await loadIepRoster(parsed.data.cycleId)
  const id = parsed.data.sessionLabelId
  if (id && !result.sessions.some(session => session.labelId === id)) throw createError({ statusCode: 404, statusMessage: 'Test day not found in this cycle roster.' })
  const rows = id ? result.rows.filter(row => row.sessionLabelId === id) : []
  const counts = new Map<string, number>()
  for (const row of rows) counts.set(row.finalGroup, (counts.get(row.finalGroup) || 0) + 1)
  return { ...result, rows, groups: [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([name, count]) => ({ name, count })) }
})
