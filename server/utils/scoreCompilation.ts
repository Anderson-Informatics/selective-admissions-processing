import type { AnyBulkWriteOperation } from 'mongoose'
import { ApplicationModel } from '../models/Application'
import { GpaRecordModel, type GpaRecord } from '../models/GpaRecord'
import { HSPTResultModel } from '../models/HSPTResult'
import { ReviewModel } from '../models/Review'
import { ReviewStageModel } from '../models/ReviewStage'
import { ScoreRecordModel, type ScoreRecord } from '../models/ScoreRecord'
import { SubmissionModel } from '../models/Submission'
import {
  DEFAULT_GPA_TABLE,
  computeGpaScore,
  deriveGpaMultiplier,
  resolveGpaBonusLabelId,
  type GpaTableBand,
  type MultiplierMap
} from './gpaScoring'
import { resolveGpa, type RoutingReview } from './routingEvaluator'
import { selectDpscdSnapshot } from './dpscdSnapshots'
import type { CycleRoundInput } from './cycleRounds'

// ---------------------------------------------------------------------------
// Score compilation
//
// Per-application scoring recipe configured on Application.scoring. Merges
// HSPT, resolved GPA (score = banded table x multiplier + label bonus),
// essay mean, DPSCD bonus, and Marygrove catchment bonus into ScoreRecord
// docs with two totals: totalAppScore (no Marygrove bonus) and
// totalMarygroveScore (includes it). Percentile ranks are computed across
// the compiled population.
// ---------------------------------------------------------------------------

export type ScoreComponent = 'gpa' | 'exam' | 'essay' | 'dpscdBonus' | 'marygroveBonus'

export interface InternalFieldMapping {
  /** Data source for this field's value. */
  source: 'scoring' | 'hspt' | 'gpa' | 'submission' | 'placement' | 'condition' | string
  /** Field name within the source (e.g. 'totalAppScore', 'exam.overall', 'mappedFields.DOB'). */
  field?: string
  /** Fallback written when the source yields no value. */
  default?: unknown
}

export interface InternalFormConfig {
  formId?: string
  /** Submittable formFieldId → source mapping. */
  fields?: Record<string, InternalFieldMapping>
}

export interface ScoringConfig {
  enabled: boolean
  components: ScoreComponent[]
  /** Gate totals on hsptTaken && gpaRecorded && essayScored (legacy behavior). */
  requireComplete: boolean
  gpaTable: GpaTableBand[]
  gpaBonusPoints: number
  dpscdBonusPoints: number
  marygroveBonuses: { primary: number, secondary: number }
  multiplierMap: MultiplierMap
  internalForm?: InternalFormConfig
  gpaStatusLabels?: Record<string, string>
}

const ALL_COMPONENTS: ScoreComponent[] = ['gpa', 'exam', 'essay', 'dpscdBonus', 'marygroveBonus']

export function normalizeScoringConfig(raw: unknown): ScoringConfig {
  const config = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
  const internalForm = (config.internalForm && typeof config.internalForm === 'object' ? config.internalForm : undefined) as Record<string, unknown> | undefined
  const gpaStatusLabels = (config.gpaStatusLabels && typeof config.gpaStatusLabels === 'object' ? config.gpaStatusLabels : {}) as Record<string, unknown>
  const marygrove = (config.marygroveBonuses && typeof config.marygroveBonuses === 'object' ? config.marygroveBonuses : {}) as Record<string, unknown>
  const multiplier = (config.multiplierMap && typeof config.multiplierMap === 'object' ? config.multiplierMap : {}) as Record<string, unknown>
  return {
    enabled: config.enabled === true,
    components: (Array.isArray(config.components) ? config.components : ALL_COMPONENTS)
      .filter((item): item is ScoreComponent => ALL_COMPONENTS.includes(item as ScoreComponent)),
    requireComplete: config.requireComplete !== false,
    gpaTable: Array.isArray(config.gpaTable) && config.gpaTable.length ? config.gpaTable as GpaTableBand[] : DEFAULT_GPA_TABLE,
    gpaBonusPoints: typeof config.gpaBonusPoints === 'number' ? config.gpaBonusPoints : 5,
    dpscdBonusPoints: typeof config.dpscdBonusPoints === 'number' ? config.dpscdBonusPoints : 10,
    marygroveBonuses: {
      primary: typeof marygrove.primary === 'number' ? marygrove.primary : 10,
      secondary: typeof marygrove.secondary === 'number' ? marygrove.secondary : 5
    },
    multiplierMap: {
      semesters: (multiplier.semesters && typeof multiplier.semesters === 'object' ? multiplier.semesters : {}) as Record<string, number>,
      quarters: (multiplier.quarters && typeof multiplier.quarters === 'object' ? multiplier.quarters : {}) as Record<string, number>
    },
    gpaStatusLabels: Object.fromEntries(
      Object.entries(gpaStatusLabels)
        .filter(([status, labelId]) => status.trim() !== '' && typeof labelId === 'string' && labelId.trim() !== '')
        .map(([status, labelId]) => [status, labelId as string])
    ),
    ...(internalForm
      ? { internalForm: {
          formId: typeof internalForm.formId === 'string' ? internalForm.formId : undefined,
          fields: (internalForm.fields && typeof internalForm.fields === 'object' ? internalForm.fields : {}) as Record<string, InternalFieldMapping>
        } }
      : {})
  }
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function isCompletedReview(review: { status?: string, completedAt?: Date | string }): boolean {
  const status = review.status?.trim().toLowerCase()
  return Boolean(review.completedAt) || status === 'complete' || status === 'completed'
}

function latestCompletedReview(reviews: RoutingReview[]): RoutingReview | undefined {
  const timestamp = (review: RoutingReview, key: 'completedAt' | 'createdAt') => review[key] ? new Date(review[key]!).getTime() : 0
  return reviews.filter(isCompletedReview)
    .sort((a, b) => timestamp(b, 'completedAt') - timestamp(a, 'completedAt') || timestamp(b, 'createdAt') - timestamp(a, 'createdAt'))[0]
}

function isPartialGpaReview(review: RoutingReview): boolean {
  return /partial\s*gpa|gpa\s*partial/i.test(review.stageName || '') || Object.hasOwn(review.mappedData || {}, 'PartialGPA')
}

function truthyYes(value: unknown): boolean {
  return /^(yes|true|y)$/i.test(String(value ?? '').trim())
}

export interface CompiledScore {
  submissionId: string
  record: Omit<ScoreRecord, 'createdAt' | 'updatedAt'>
}

export interface CompilationSummary {
  applicationId: string
  submissions: number
  compiled: number
  ready: number
  missingExam: number
  missingGpa: number
  missingEssay: number
}

export interface CompilationOutput {
  records: CompiledScore[]
  gpaOperations: AnyBulkWriteOperation<GpaRecord>[]
  summary: CompilationSummary
}

interface CompileInputs {
  cycleId: string
  applicationId: string
  config: ScoringConfig
  jobId?: string
  gpaBonusLabelId?: string
  now?: Date
}

export async function compileApplicationScores(input: CompileInputs): Promise<CompilationOutput> {
  const { cycleId, applicationId, config } = input
  const now = input.now || new Date()
  const has = (component: ScoreComponent) => config.components.includes(component)

  const submissions = await SubmissionModel.find({ cycleId, applicationId }).lean()
  const submissionIds = submissions.map(submission => submission.submissionId)

  const [hsptResults, gpaRecords, reviews, essayStages] = await Promise.all([
    has('exam')
      ? HSPTResultModel.find({ cycleId, linkedSubmissionId: { $in: submissionIds }, status: 'linked' }).lean()
      : Promise.resolve([]),
    has('gpa')
      ? GpaRecordModel.find({ cycleId, submissionId: { $in: submissionIds } }).lean()
      : Promise.resolve([]),
    ReviewModel.find({ cycleId, applicationId, submissionId: { $in: submissionIds } }).lean(),
    has('essay')
      ? ReviewStageModel.find({ cycleId, applicationId, name: /essay/i }).select('stageId name').lean()
      : Promise.resolve([])
  ])

  const hsptBySubmission = new Map(hsptResults.map(result => [result.linkedSubmissionId!, result]))
  const gpaBySubmission = new Map(gpaRecords.map(record => [record.submissionId, record]))
  const reviewsBySubmission = new Map<string, RoutingReview[]>()
  const stageNames = new Map<string, string>()
  for (const stage of essayStages) stageNames.set(stage.stageId, stage.name)
  for (const review of reviews) {
    const list = reviewsBySubmission.get(review.submissionId) || []
    list.push({
      stageId: review.stageId,
      stageName: review.stageName || stageNames.get(review.stageId),
      status: review.status,
      score: review.score,
      completedAt: review.completedAt,
      createdAt: review.createdAt,
      mappedData: review.mappedData || {}
    })
    reviewsBySubmission.set(review.submissionId, list)
  }

  let rounds: CycleRoundInput[] = []
  if (gpaRecords.some(record => record.dpscd?.snapshots)) {
    const applications = await ApplicationModel.find({ _id: applicationId }).lean()
    rounds = applications[0]?.rounds || []
  }
  const essayStageIds = new Set(essayStages.map(stage => stage.stageId))
  const bonusLabelId = input.gpaBonusLabelId ?? await resolveGpaBonusLabelId()

  const records: CompiledScore[] = []
  const gpaOperations: AnyBulkWriteOperation<GpaRecord>[] = []
  const summary: CompilationSummary = {
    applicationId,
    submissions: submissions.length,
    compiled: 0,
    ready: 0,
    missingExam: 0,
    missingGpa: 0,
    missingEssay: 0
  }

  for (const submission of submissions) {
    const submissionReviews = reviewsBySubmission.get(submission.submissionId) || []
    const storedGpa = gpaBySubmission.get(submission.submissionId)
    const gpaRecord = storedGpa ? { ...storedGpa, dpscd: selectDpscdSnapshot(storedGpa.dpscd, submission, rounds) } : undefined
    const mustResolve = Boolean(gpaRecord?.dpscd?.snapshots) || (typeof gpaRecord?.dpscd?.quartersAvailable === 'number' && gpaRecord.dpscd.quartersAvailable < 6)
    const resolved = mustResolve
      ? resolveGpa({
          submission: { submissionId: submission.submissionId, mappedFields: submission.mappedFields || {}, isMapped: submission.isMapped === true },
          reviews: submissionReviews,
          gpa: gpaRecord
        })
      : undefined

    const hspt = has('exam') ? hsptBySubmission.get(submission.submissionId) : undefined
    const hsptTaken = Boolean(hspt)

    const resolvedGpa = resolved ? resolved.cumulativeGpa : gpaRecord?.resolvedCumulativeGpa
    const resolvedSource = resolved ? resolved.source : gpaRecord?.resolvedSource
    const gpaRecorded = toNumber(resolvedGpa) != null
    const partialReview = has('gpa') ? latestCompletedReview(submissionReviews.filter(isPartialGpaReview)) : undefined
    const multiplier = has('gpa')
      ? deriveGpaMultiplier({
          resolvedSource,
          hasResolvedGpa: gpaRecorded,
          semesters: partialReview?.mappedData?.Semesters,
          quartersAvailable: gpaRecord?.dpscd?.quartersAvailable
        }, config.multiplierMap)
      : 0
    const gpaBonusEligible = has('gpa') && Boolean(bonusLabelId) && (submission.labelIds || []).includes(bonusLabelId!)
    const gpaBonus = gpaBonusEligible ? config.gpaBonusPoints : 0
    const gpaScore = has('gpa') ? (gpaRecorded ? computeGpaScore(toNumber(resolvedGpa), multiplier, gpaBonus, config.gpaTable) : null) : 0

    const essayReviews = has('essay') ? submissionReviews.filter(review => essayStageIds.has(review.stageId) && isCompletedReview(review)) : []
    const essayScores = essayReviews.map(review => toNumber(review.score)).filter((score): score is number => score != null)
    const essayScore = essayScores.length ? round2(essayScores.reduce((sum, score) => sum + score, 0) / essayScores.length) : null
    const essayScored = has('essay') ? essayScore != null : true

    const dpscdEligible = has('dpscdBonus') && (Boolean(gpaRecord?.dpscd) || truthyYes(submission.mappedFields?.DPSCD))
    const dpscdBonus = dpscdEligible ? config.dpscdBonusPoints : 0
    const catchment = submission.catchment?.marygrove || 'None'
    const marygroveBonus = has('marygroveBonus')
      ? (catchment === 'Primary' ? config.marygroveBonuses.primary : catchment === 'Secondary' ? config.marygroveBonuses.secondary : 0)
      : 0

    const ready = (!has('exam') || hsptTaken) && (!has('gpa') || gpaRecorded) && essayScored
    const gated = config.requireComplete && !ready
    const examScore = hspt?.overall ?? 0
    const base = gated ? 0 : round2(examScore + (gpaScore ?? 0) + (essayScore ?? 0) + dpscdBonus)
    const totalAppScore = base
    const totalMarygroveScore = gated ? 0 : round2(base + marygroveBonus)

    summary.compiled += 1
    if (ready) summary.ready += 1
    if (has('exam') && !hsptTaken) summary.missingExam += 1
    if (has('gpa') && !gpaRecorded) summary.missingGpa += 1
    if (has('essay') && !essayScored) summary.missingEssay += 1

    records.push({
      submissionId: submission.submissionId,
      record: {
        cycleId,
        applicationId,
        submissionId: submission.submissionId,
        hsptTaken,
        gpaRecorded,
        essayScored: has('essay') ? essayScored : false,
        gpa: {
          raw: toNumber(resolvedGpa),
          source: resolvedSource ?? null,
          multiplier,
          bonus: gpaBonus,
          score: gpaScore
        },
        ...(hspt
          ? { exam: {
              reading: hspt.reading,
              math: hspt.math,
              language: hspt.language,
              science: hspt.science,
              overall: hspt.overall,
              hsptResultId: hspt.sourceId,
              matchType: hspt.matchType
            } }
          : {}),
        ...(has('essay')
          ? { essay: { score: essayScore, reviewCount: essayReviews.length } }
          : {}),
        dpscdBonus,
        marygroveBonus,
        marygroveCatchment: catchment,
        totalAppScore,
        totalMarygroveScore,
        compiledAt: now,
        compileJobId: input.jobId,
        internalFormSyncStatus: 'pending'
      }
    })

    if (has('gpa')) {
      gpaOperations.push({
        updateOne: {
          filter: { cycleId, submissionId: submission.submissionId },
          update: {
            $setOnInsert: { cycleId, submissionId: submission.submissionId },
            $set: {
              ...(resolved ? { resolvedCumulativeGpa: resolved.cumulativeGpa, resolvedSource: resolved.source } : {}),
              gpaMultiplier: multiplier,
              gpaBonusEligible,
              gpaBonus,
              gpaScore
            }
          },
          upsert: true
        }
      })
    }
  }

  return { records, gpaOperations, summary }
}

// ---------------------------------------------------------------------------
// Percentiles
// ---------------------------------------------------------------------------

const PERCENTILE_KEYS: { key: string, pick: (record: CompiledScore['record']) => number | null | undefined }[] = [
  { key: 'total', pick: record => record.totalAppScore },
  { key: 'totalMarygrove', pick: record => record.totalMarygroveScore },
  { key: 'gpa', pick: record => record.gpa?.score },
  { key: 'gpaRaw', pick: record => record.gpa?.raw },
  { key: 'essay', pick: record => record.essay?.score },
  { key: 'exam', pick: record => record.exam?.overall },
  { key: 'examReading', pick: record => record.exam?.reading },
  { key: 'examMath', pick: record => record.exam?.math },
  { key: 'examLanguage', pick: record => record.exam?.language },
  { key: 'examScience', pick: record => record.exam?.science }
]

export function computePercentiles(records: CompiledScore[]): Map<string, Record<string, number | null>> {
  const result = new Map<string, Record<string, number | null>>()
  for (const { key, pick } of PERCENTILE_KEYS) {
    const values = records.map(item => pick(item.record)).filter((value): value is number => value != null)
    for (const item of records) {
      const value = pick(item.record)
      const percentiles = result.get(item.submissionId) || {}
      percentiles[key] = value == null || !values.length
        ? null
        : round2((values.filter(other => other < value).length / values.length) * 100)
      result.set(item.submissionId, percentiles)
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Job entry point
// ---------------------------------------------------------------------------

export interface RunScoreCompilationOptions {
  cycleId: string
  applicationId?: string
  dryRun?: boolean
  jobId?: string
  setProgress?: (update: { phase?: string, processed?: number, total?: number, message?: string }) => Promise<void>
}

export async function runScoreCompilation(options: RunScoreCompilationOptions) {
  const applicationFilter: Record<string, unknown> = { 'cycleId': options.cycleId, 'scoring.enabled': true }
  if (options.applicationId) applicationFilter._id = options.applicationId
  const applications = await ApplicationModel.find(applicationFilter).lean()
  if (!applications.length) {
    return { status: 'completed', result: { applications: [], message: 'No applications have scoring enabled' } }
  }

  const bonusLabelId = await resolveGpaBonusLabelId()
  const summaries: CompilationSummary[] = []
  const details: { applicationId: string, name: string, summary: CompilationSummary }[] = []

  for (const [index, application] of applications.entries()) {
    const applicationId = String(application._id)
    const config = normalizeScoringConfig(application.scoring)
    const output = await compileApplicationScores({
      cycleId: options.cycleId,
      applicationId,
      config,
      jobId: options.jobId,
      gpaBonusLabelId: bonusLabelId
    })

    const percentiles = computePercentiles(output.records)
    for (const item of output.records) {
      item.record.percentiles = percentiles.get(item.submissionId) || {}
    }

    if (!options.dryRun) {
      const operations: AnyBulkWriteOperation<ScoreRecord>[] = output.records.map(item => ({
        updateOne: {
          filter: { cycleId: options.cycleId, applicationId, submissionId: item.submissionId },
          update: { $set: item.record, $setOnInsert: { cycleId: options.cycleId, applicationId, submissionId: item.submissionId } },
          upsert: true
        }
      }))
      for (let i = 0; i < operations.length; i += 500) {
        await ScoreRecordModel.bulkWrite(operations.slice(i, i + 500))
      }
      if (output.gpaOperations.length) await GpaRecordModel.bulkWrite(output.gpaOperations)
    }

    summaries.push(output.summary)
    details.push({ applicationId, name: application.name, summary: output.summary })
    await options.setProgress?.({
      phase: 'compiling',
      processed: index + 1,
      total: applications.length,
      message: `${options.dryRun ? 'Evaluated' : 'Compiled'} ${application.name}: ${output.summary.compiled} submissions`
    })
  }

  return {
    status: 'completed' as const,
    result: {
      dryRun: options.dryRun === true,
      applications: details
    }
  }
}
