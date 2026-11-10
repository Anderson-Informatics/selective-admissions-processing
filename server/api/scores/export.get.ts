import * as XLSX from 'xlsx'
import { ScoreRecordModel } from '../../models/ScoreRecord'
import { recordDisclosure } from '../../utils/disclosureAudit'

export default defineEventHandler(async (event) => {
  await connectDb()
  const user = await requireAuth(event)
  const { cycleId, applicationId } = getQuery(event) as { cycleId?: string, applicationId?: string }
  if (!cycleId) {
    throw createError({ statusCode: 400, statusMessage: 'cycleId is required' })
  }

  const filter: Record<string, unknown> = { cycleId }
  if (applicationId) filter.applicationId = applicationId
  const records = await ScoreRecordModel.find(filter).sort({ applicationId: 1, submissionId: 1 }).limit(20000).lean()

  const rows = records.map(record => ({
    applicationId: record.applicationId,
    submissionId: record.submissionId,
    hsptTaken: record.hsptTaken,
    gpaRecorded: record.gpaRecorded,
    essayScored: record.essayScored,
    gpa: record.gpa?.raw,
    gpaSource: record.gpa?.source,
    gpaMultiplier: record.gpa?.multiplier,
    gpaBonus: record.gpa?.bonus,
    gpaScore: record.gpa?.score,
    examReading: record.exam?.reading,
    examMath: record.exam?.math,
    examLanguage: record.exam?.language,
    examScience: record.exam?.science,
    examScore: record.exam?.overall,
    essayScore: record.essay?.score,
    essayReviewCount: record.essay?.reviewCount,
    dpscdBonus: record.dpscdBonus,
    marygroveCatchment: record.marygroveCatchment,
    marygroveBonus: record.marygroveBonus,
    totalAppScore: record.totalAppScore,
    totalMarygroveScore: record.totalMarygroveScore,
    percentileTotal: record.percentiles?.total,
    percentileGpa: record.percentiles?.gpa,
    percentileEssay: record.percentiles?.essay,
    percentileExam: record.percentiles?.exam,
    percentileExamReading: record.percentiles?.examReading,
    percentileExamMath: record.percentiles?.examMath,
    percentileExamLanguage: record.percentiles?.examLanguage,
    percentileExamScience: record.percentiles?.examScience,
    internalFormSyncStatus: record.internalFormSyncStatus,
    internalFormSyncedAt: record.internalFormSyncedAt,
    compiledAt: record.compiledAt
  }))

  const worksheet = XLSX.utils.json_to_sheet(rows)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Scores')
  const content = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer

  await recordDisclosure({
    actor: user.email,
    action: 'pii_export',
    entityType: 'score_records',
    entityId: cycleId,
    detail: { applicationId: applicationId ?? null, rows: records.length }
  })

  setResponseHeader(event, 'Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  setResponseHeader(event, 'Content-Disposition', `attachment; filename="scores-${cycleId}${applicationId ? `-${applicationId}` : ''}.xlsx"`)
  return content
})
