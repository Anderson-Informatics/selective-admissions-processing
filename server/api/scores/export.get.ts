import * as XLSX from 'xlsx'
import { ScoreRecordModel } from '../../models/ScoreRecord'
import { SubmissionModel } from '../../models/Submission'
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
  const withdrawnIds = await SubmissionModel.distinct('submissionId', { cycleId, status: /^withdrawn$/i })
  if (withdrawnIds.length) filter.submissionId = { $nin: withdrawnIds }
  const records = await ScoreRecordModel.find(filter).sort({ applicationId: 1, submissionId: 1 }).limit(20000).lean()

  const rows = records.map(record => ({
    applicationId: record.applicationId,
    submissionId: record.submissionId,
    placementPathway: record.placementPathway,
    inputsComplete: record.inputsComplete,
    missingInputs: record.missingInputs?.join('; '),
    proposedSchool: record.decision?.proposed?.schoolName,
    proposedChoice: record.decision?.proposed?.rank,
    proposalStatus: record.decision ? 'Proposed only — not final placement' : undefined,
    waitlists: record.decision?.waitlists.map(item => `${item.rank ?? 'Unranked'}: ${item.schoolName}`).join('; '),
    decisionWarnings: record.decision?.diagnostics.join('; '),
    configFingerprint: record.configFingerprint,
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
  const decisions = records.flatMap(record => (record.decision?.schools || []).map(school => ({
    applicationId: record.applicationId, submissionId: record.submissionId, schoolId: school.schoolId, school: school.schoolName, choice: school.rank, decision: school.outcome,
    primaryUserId: school.primaryUserId, controllingEntries: school.controllingEntryIds.join('; '), proposed: record.decision?.proposed?.schoolId === school.schoolId,
    waitlistAboveProposal: record.decision?.waitlists.find(item => item.schoolId === school.schoolId)?.aboveProposal,
    evidenceCount: school.evidence.length, compiledAt: record.compiledAt, configFingerprint: record.configFingerprint, status: 'Proposed only — not final placement'
  })))
  if (decisions.length) XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(decisions), 'School decisions')
  const evidence = records.flatMap(record => [
    ...(record.decision?.schools || []).flatMap(school => school.evidence.map(item => ({ submissionId: record.submissionId, applicationId: record.applicationId, schoolId: school.schoolId, ...item, value: typeof item.value === 'object' ? JSON.stringify(item.value) : item.value, controlling: school.controllingEntryIds.includes(item.entryId) }))),
    ...(record.decision?.unattributedEvidence || []).map(item => ({ submissionId: record.submissionId, applicationId: record.applicationId, schoolId: '', ...item, value: typeof item.value === 'object' ? JSON.stringify(item.value) : item.value, controlling: false }))
  ])
  if (evidence.length) XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(evidence), 'Decision evidence')
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
