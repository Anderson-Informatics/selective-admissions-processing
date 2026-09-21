import { parse } from 'csv-parse/sync'
import type { AnyBulkWriteOperation } from 'mongoose'
import { CycleModel } from '../models/Cycle'
import { HSPTResultModel, type HSPTResult } from '../models/HSPTResult'
import { SubmissionModel } from '../models/Submission'

export interface HSPTParseResult {
  processed: number
  inserted: number
  updated: number
  errors: string[]
}

export interface HSPTMatchResult {
  exact: number
  fuzzy: number
  unmatched: number
  byType: Record<string, number>
}

function normalize(value: string | undefined): string {
  return (value || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function normalizeIdentifier(value: unknown): string {
  return String(value ?? '').trim()
}

function parseDate(value: string): { date: Date | null, raw: string, key: string } {
  const input = (value || '').trim()
  const slashMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(input)
  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(input)
  if (!slashMatch && !isoMatch) return { date: null, raw: input, key: '' }

  const month = Number(slashMatch?.[1] || isoMatch?.[2])
  const day = Number(slashMatch?.[2] || isoMatch?.[3])
  const yearText = slashMatch?.[3] || isoMatch?.[1] || ''
  let year = Number(yearText)
  if (yearText.length === 2) year += year < 30 ? 2000 : 1900

  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    Number.isNaN(date.getTime())
    || date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return { date: null, raw: input, key: '' }
  }

  const monthText = String(month).padStart(2, '0')
  const dayText = String(day).padStart(2, '0')
  return {
    date,
    raw: `${monthText}/${dayText}/${year}`,
    key: `${year}-${monthText}-${dayText}`
  }
}

function scoreValue(value: string | undefined): number {
  const n = Number(value)
  return Number.isNaN(n) ? 0 : n
}

function computeScaledScores(rdrs: number, mtrs: number, lnrs: number, oprs: number) {
  const reading = (rdrs / 62) * 11.25
  const math = (mtrs / 64) * 15
  const language = (lnrs / 60) * 11.25
  const science = (oprs / 40) * 7.5
  return {
    reading,
    math,
    language,
    science,
    overall: reading + math + language + science
  }
}

function levenshtein(a: string, b: string): number {
  const matrix: number[][] = []
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b[i - 1] === a[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      )
    }
  }
  return matrix[b.length][a.length]
}

function similarity(a: string, b: string): number {
  const a1 = normalize(a)
  const b1 = normalize(b)
  if (a1 === b1) return 1
  const max = Math.max(a1.length, b1.length)
  if (max === 0) return 0
  const dist = levenshtein(a1, b1)
  return Math.max(0, 1 - dist / max)
}

function buildSourceId(
  hpid: string,
  testCenter: string,
  batch: string,
  lastName: string,
  firstName: string,
  birth: string
) {
  return `${normalize(hpid)}|${normalize(testCenter)}|${normalize(batch)}|${normalize(lastName)}|${normalize(firstName)}|${birth}`
}

function parseRows(content: string): Record<string, string>[] {
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    cast: false
  })
  return (records || []) as Record<string, string>[]
}

export function previewHSPTCsv(sourceFile: string, content: string) {
  const rows = parseRows(content)
  const errors: string[] = []
  let valid = 0

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]!
    if (!row.HPID || !row.Last || !row.First) {
      errors.push(`${sourceFile}, row ${index + 2}: missing HPID, Last, or First`)
    } else {
      valid += 1
    }
  }

  return {
    processed: rows.length,
    valid,
    invalid: rows.length - valid,
    errors
  }
}

function hasResultIdColumn(row: Record<string, string>) {
  return 'ResultID' in row
}

export async function parseAndUpsertHSPTCsv(
  cycleId: string,
  sourceFile: string,
  content: string
): Promise<HSPTParseResult> {
  const rows = parseRows(content)
  if (!rows.length) {
    return { processed: 0, inserted: 0, updated: 0, errors: [] }
  }

  const cycle = await CycleModel.findOneAndUpdate(
    { _id: cycleId },
    { $inc: { hsptResultIdCounter: rows.length } },
    { returnDocument: 'after', upsert: false }
  )

  if (!cycle || !cycle.hsptResultIdCounter) {
    throw createError({ statusCode: 500, statusMessage: 'Failed to reserve ResultID counter' })
  }

  const endCounter = cycle.hsptResultIdCounter
  const startCounter = endCounter - rows.length + 1
  if (endCounter > 9999) {
    throw createError({ statusCode: 400, statusMessage: 'ResultID counter overflow for cycle' })
  }

  const usesResultId = hasResultIdColumn(rows[0])
  const errors: string[] = []
  const operations: AnyBulkWriteOperation<HSPTResult>[] = []
  let inserted = 0
  let updated = 0

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const hpid = row.HPID || ''
    const lastName = row.Last || ''
    const firstName = row.First || ''
    const testCenter = row.TestCenter || ''
    const batch = row.batch || ''
    const birth = parseDate(row.Birth || '')
    const optCd = (row.OptCd || '').trim()

    if (!hpid || !lastName || !firstName) {
      errors.push(`Missing key fields in row ${i + 1}`)
      continue
    }

    const resultId = usesResultId ? Number(row.ResultID) || undefined : startCounter + i
    const sourceId = buildSourceId(hpid, testCenter, batch, lastName, firstName, birth.raw)

    const rdrs = scoreValue(row.RDRS)
    const mtrs = scoreValue(row.MTRS)
    const lnrs = scoreValue(row.LNRS)
    const oprs = scoreValue(row.OPRS)
    const scaled = computeScaledScores(rdrs, mtrs, lnrs, oprs)
    const now = new Date()

    operations.push({
      updateOne: {
        filter: { cycleId, sourceId },
        update: {
          $setOnInsert: {
            cycleId,
            sourceId,
            resultId,
            hpid,
            testCenter,
            batch,
            createdAt: now
          },
          $set: {
            lastName,
            firstName,
            gender: row.Gender || '',
            age: row.Age || '',
            birth: birth.raw,
            birthDate: birth.date,
            optCd,
            rdrs,
            mtrs,
            lnrs,
            oprs,
            reading: scaled.reading,
            math: scaled.math,
            language: scaled.language,
            science: scaled.science,
            overall: scaled.overall,
            sourceFile,
            updatedAt: now
          }
        },
        upsert: true
      }
    })
  }

  if (operations.length) {
    const result = await HSPTResultModel.bulkWrite(operations)
    inserted = result.upsertedCount
    updated = result.modifiedCount
  }

  return { processed: rows.length, inserted, updated, errors }
}

interface SubmissionCandidate {
  submissionId: string
  submissionIdInt?: number
  firstName: string
  lastName: string
  studentNumber: string
  birthKey: string
}

interface MatchInput {
  firstName: string
  lastName: string
  birth: string
  optCd: string
}

interface MatchEvaluation {
  category: 'linked' | 'needsReview' | 'unlinked'
  submissionId?: string
  matchType?: string
  score: number
}

interface MatchContext {
  candidates: SubmissionCandidate[]
  studentNumberByValue: Map<string, string>
  submissionIdIntByValue: Map<string, string>
}

function resolveFuzzyThreshold(threshold?: number) {
  const config = useRuntimeConfig()
  return threshold ?? (Number(config.hsptFuzzyThreshold) || 0.6)
}

async function loadMatchContext(cycleId: string): Promise<MatchContext> {
  const linkedSubmissionIds = await HSPTResultModel.distinct('linkedSubmissionId', {
    cycleId,
    status: 'linked',
    linkedSubmissionId: { $exists: true, $ne: null }
  })
  const submissions = await SubmissionModel.find({
    cycleId,
    status: { $ne: 'withdrawn' },
    submissionId: { $nin: linkedSubmissionIds }
  }).select('submissionId submissionIdInt mappedFields').lean()

  const candidates: SubmissionCandidate[] = submissions.map((submission) => {
    const dob = parseDate(String(submission.mappedFields?.DOB || ''))
    return {
      submissionId: submission.submissionId,
      submissionIdInt: submission.submissionIdInt,
      firstName: String(submission.mappedFields?.FirstName || ''),
      lastName: String(submission.mappedFields?.LastName || ''),
      studentNumber: normalizeIdentifier(submission.mappedFields?.StudentNumber),
      birthKey: dob.key
    }
  })

  const studentNumberByValue = new Map<string, string>()
  const submissionIdIntByValue = new Map<string, string>()
  for (const candidate of candidates) {
    const studentNumber = normalizeIdentifier(candidate.studentNumber)
    const submissionIdInt = normalizeIdentifier(candidate.submissionIdInt)
    if (studentNumber) studentNumberByValue.set(studentNumber, candidate.submissionId)
    if (submissionIdInt) submissionIdIntByValue.set(submissionIdInt, candidate.submissionId)
  }

  return { candidates, studentNumberByValue, submissionIdIntByValue }
}

function evaluateMatch(input: MatchInput, context: MatchContext, fuzzyThreshold: number): MatchEvaluation {
  const optCd = normalizeIdentifier(input.optCd)
  if (optCd) {
    const studentNumberMatch = context.studentNumberByValue.get(optCd)
    if (studentNumberMatch) {
      return { category: 'linked', submissionId: studentNumberMatch, matchType: 'OptCd: StudentNumber', score: 1 }
    }
    const submissionIdMatch = context.submissionIdIntByValue.get(optCd)
    if (submissionIdMatch) {
      return { category: 'linked', submissionId: submissionIdMatch, matchType: 'OptCd: SubmissionIdInt', score: 1 }
    }
  }

  let bestSubmissionId: string | undefined
  let bestScore = 0
  let bestType = ''
  const resultBirthKey = parseDate(input.birth || '').key

  for (const candidate of context.candidates) {
    const normalFirstScore = similarity(input.firstName, candidate.firstName)
    const normalLastScore = similarity(input.lastName, candidate.lastName)
    const swappedFirstScore = similarity(input.firstName, candidate.lastName)
    const swappedLastScore = similarity(input.lastName, candidate.firstName)
    const normalNameScore = normalFirstScore + normalLastScore
    const swappedNameScore = swappedFirstScore + swappedLastScore
    const swapped = swappedNameScore > normalNameScore
    const firstScore = swapped ? swappedFirstScore : normalFirstScore
    const lastScore = swapped ? swappedLastScore : normalLastScore
    const averageNameScore = (firstScore + lastScore) / 2
    if (averageNameScore < 0.6) continue

    const dobMatch = resultBirthKey && candidate.birthKey && resultBirthKey === candidate.birthKey ? 1 : 0
    const score = firstScore * 0.45 + lastScore * 0.45 + dobMatch * 0.1

    if (score > bestScore) {
      bestScore = score
      bestSubmissionId = candidate.submissionId
      const prefix = swapped ? 'Swapped ' : ''
      const strongNames = firstScore >= 0.8 && lastScore >= 0.8
      if (strongNames && dobMatch === 1) bestType = `${prefix}Name+DOB`
      else if (strongNames) bestType = `${prefix}Name`
      else if (dobMatch === 1) bestType = `${prefix}Partial Name+DOB`
      else bestType = `${prefix}Partial Name`
    }
  }

  const perfectNameDob = bestScore >= 0.999999 && ['Name+DOB', 'Swapped Name+DOB'].includes(bestType)
  if (bestSubmissionId && perfectNameDob) {
    return { category: 'linked', submissionId: bestSubmissionId, matchType: bestType, score: 1 }
  }

  return bestSubmissionId && bestScore >= fuzzyThreshold
    ? { category: 'needsReview', submissionId: bestSubmissionId, matchType: bestType, score: bestScore }
    : { category: 'unlinked', score: bestScore }
}

export async function previewHSPTMatching(
  cycleId: string,
  files: { content: string }[],
  threshold?: number
) {
  const context = await loadMatchContext(cycleId)
  const fuzzyThreshold = resolveFuzzyThreshold(threshold)
  const summary = {
    linked: 0,
    needsReview: 0,
    unlinked: 0,
    byType: {} as Record<string, number>
  }

  for (const file of files) {
    for (const row of parseRows(file.content)) {
      if (!row.HPID || !row.Last || !row.First) continue
      const evaluation = evaluateMatch({
        firstName: row.First,
        lastName: row.Last,
        birth: row.Birth || '',
        optCd: row.OptCd || ''
      }, context, fuzzyThreshold)
      summary[evaluation.category] += 1
      if (evaluation.matchType) {
        summary.byType[evaluation.matchType] = (summary.byType[evaluation.matchType] || 0) + 1
      }
    }
  }

  return summary
}

export async function runHSPTMatching(cycleId: string, threshold?: number): Promise<HSPTMatchResult> {
  const fuzzyThreshold = resolveFuzzyThreshold(threshold)
  const [results, context] = await Promise.all([
    HSPTResultModel.find({ cycleId, status: 'unlinked' }).lean(),
    loadMatchContext(cycleId)
  ])

  let exact = 0
  let fuzzy = 0
  let unmatched = 0
  const byType: Record<string, number> = {}
  const exactOps: AnyBulkWriteOperation<HSPTResult>[] = []
  const exactLinks: { resultId: string, submissionId: string, matchType: string }[] = []
  const fuzzyOps: AnyBulkWriteOperation<HSPTResult>[] = []
  const unmatchedOps: AnyBulkWriteOperation<HSPTResult>[] = []

  for (const result of results) {
    const evaluation = evaluateMatch(result, context, fuzzyThreshold)
    if (evaluation.matchType) byType[evaluation.matchType] = (byType[evaluation.matchType] || 0) + 1

    if (evaluation.category === 'linked' && evaluation.submissionId && evaluation.matchType) {
      exactOps.push({
        updateOne: {
          filter: { _id: result._id },
          update: {
            $set: {
              linkedSubmissionId: evaluation.submissionId,
              matchType: evaluation.matchType,
              matchScore: evaluation.score,
              status: 'linked',
              updatedAt: new Date()
            }
          }
        }
      })
      exactLinks.push({ resultId: String(result._id), submissionId: evaluation.submissionId, matchType: evaluation.matchType })
      exact += 1
    } else if (evaluation.category === 'needsReview' && evaluation.submissionId) {
      fuzzyOps.push({
        updateOne: {
          filter: { _id: result._id },
          update: {
            $set: {
              linkedSubmissionId: evaluation.submissionId,
              matchType: evaluation.matchType,
              matchScore: evaluation.score,
              status: 'unlinked',
              updatedAt: new Date()
            }
          }
        }
      })
      fuzzy += 1
    } else {
      unmatchedOps.push({
        updateOne: {
          filter: { _id: result._id },
          update: {
            $set: { updatedAt: new Date() },
            $unset: { linkedSubmissionId: 1, matchType: 1, matchScore: 1 }
          }
        }
      })
      unmatched += 1
    }
  }

  if (exactOps.length) {
    await HSPTResultModel.bulkWrite(exactOps)
    for (const link of exactLinks) {
      await SubmissionModel.updateOne(
        { submissionId: link.submissionId },
        { $set: { hsptResultId: link.resultId, hsptMatchType: link.matchType } }
      )
    }
  }
  if (fuzzyOps.length) await HSPTResultModel.bulkWrite(fuzzyOps)
  if (unmatchedOps.length) await HSPTResultModel.bulkWrite(unmatchedOps)

  return { exact, fuzzy, unmatched, byType }
}

export async function linkHSPTResult(hsptResultId: string, submissionId: string): Promise<HSPTResult | null> {
  const result = await HSPTResultModel.findByIdAndUpdate(
    hsptResultId,
    { $set: { linkedSubmissionId: submissionId, status: 'linked', matchType: 'manual', matchScore: 1, updatedAt: new Date() } },
    { returnDocument: 'after' }
  ).lean()
  if (result) {
    await SubmissionModel.updateOne(
      { submissionId },
      { $set: { hsptResultId, hsptMatchType: 'manual' } }
    )
  }
  return result
}

export async function unlinkHSPTResult(hsptResultId: string): Promise<HSPTResult | null> {
  const result = await HSPTResultModel.findByIdAndUpdate(
    hsptResultId,
    { $set: { linkedSubmissionId: null, status: 'unlinked', matchType: null, matchScore: null, updatedAt: new Date() } },
    { returnDocument: 'after' }
  ).lean()
  if (result?.linkedSubmissionId) {
    await SubmissionModel.updateOne(
      { submissionId: result.linkedSubmissionId },
      { $unset: { hsptResultId: 1, hsptMatchType: 1 } }
    )
  }
  return result
}

export async function rejectHSPTResult(hsptResultId: string): Promise<HSPTResult | null> {
  const result = await HSPTResultModel.findByIdAndUpdate(
    hsptResultId,
    { $set: { status: 'rejected', updatedAt: new Date() } },
    { returnDocument: 'after' }
  ).lean()
  if (result?.linkedSubmissionId) {
    await SubmissionModel.updateOne(
      { submissionId: result.linkedSubmissionId },
      { $unset: { hsptResultId: 1, hsptMatchType: 1 } }
    )
  }
  return result
}
