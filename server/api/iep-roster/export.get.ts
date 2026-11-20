import { z } from 'zod'
import { loadIepRoster } from '../../utils/iepRosteringRun'
import { buildIepRosterExport } from '../../utils/iepRosterExport'
import { recordDisclosure } from '../../utils/disclosureAudit'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const parsed = z.object({
    cycleId: z.string().regex(/^[a-f\d]{24}$/i),
    scope: z.enum(['day', 'all']).default('day'),
    sessionLabelId: z.string().trim().min(1).optional(),
    format: z.enum(['docx', 'xlsx', 'zip']).default('zip')
  }).safeParse(getQuery(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid roster export parameters.' })
  const { cycleId, scope, sessionLabelId, format } = parsed.data
  if ((scope === 'all' && (format !== 'zip' || sessionLabelId)) || (scope === 'day' && !sessionLabelId)) {
    throw createError({ statusCode: 400, statusMessage: 'Select a test day, or request all days as ZIP without a sessionLabelId.' })
  }
  await connectDb()
  const result = await loadIepRoster(cycleId)
  if (scope === 'day' && !result.sessions.some(session => session.labelId === sessionLabelId)) throw createError({ statusCode: 404, statusMessage: 'Test day not found in this cycle roster.' })
  const rows = scope === 'all' ? result.rows : result.rows.filter(row => row.sessionLabelId === sessionLabelId)
  if (!rows.length) throw createError({ statusCode: 404, statusMessage: 'No roster students found.' })
  if (rows.some(row => !Number.isSafeInteger(row.submissionIdInt))) throw createError({ statusCode: 409, statusMessage: 'A roster student is missing a numeric Submission ID. Refresh submission data before exporting.' })
  const file = await buildIepRosterExport(rows, format, scope === 'all')
  if (file.content.length > 4_000_000) throw createError({ statusCode: 413, statusMessage: 'This roster exceeds the download size limit. Download one test day at a time.' })
  await recordDisclosure({
    actor: user.email, action: 'pii_export', entityType: 'iep_roster', entityId: cycleId,
    detail: { sessions: [...new Set(rows.map(row => row.sessionLabelId))], format, scope, rows: rows.length, generatedAt: result.generatedAt }
  })
  setResponseHeader(event, 'Content-Type', file.contentType)
  setResponseHeader(event, 'Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`)
  return file.content
})
