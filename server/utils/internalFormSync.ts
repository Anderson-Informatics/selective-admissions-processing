import { AuditLogModel } from '../models/AuditLog'
import { GpaRecordModel, type GpaRecord } from '../models/GpaRecord'
import { HSPTResultModel, type HSPTResult } from '../models/HSPTResult'
import { ScoreRecordModel, type ScoreRecord } from '../models/ScoreRecord'
import { SubmissionModel, type Submission } from '../models/Submission'
import { mapWithConcurrency } from './concurrency'
import type { InternalFieldMapping, ScoringConfig } from './scoreCompilation'
import {
  createInternalFormEntry,
  fetchEntry,
  fetchForm,
  fetchSubmissionEntries,
  updateInternalFormEntry,
  type SubmittableClientConfig,
  type SubmittableFieldData
} from './submittable'

// ---------------------------------------------------------------------------
// Internal form write-back
//
// Writes compiled ScoreRecord values to each submission's Submittable internal
// form entry using the documented v4 endpoints:
//   GET  /entries/submissions/{id}  → locate the internal entry
//   PUT  /entries/{entryId}         → update (full fieldData, diff-only)
//   POST /entries/internal          → create when no entry exists
//
// Each mapped internal-form field is bound to a data source (scoring, hspt,
// gpa, submission, placement, or condition) plus a field path and an optional
// default written when the source yields nothing.
// ---------------------------------------------------------------------------

type SetProgress = (update: { phase?: string, processed?: number, total?: number, percent?: number, message?: string }) => Promise<void>

export interface MappingContext {
  score: ScoreRecord
  submission?: Submission
  gpa?: GpaRecord
  hspt?: HSPTResult
  now: Date
}

function getPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (current && typeof current === 'object' && !Array.isArray(current)) {
      return (current as Record<string, unknown>)[key]
    }
    return undefined
  }, value)
}

const CONDITION_EXTRACTORS: Record<string, (ctx: MappingContext) => unknown> = {
  hsptTaken: ctx => ctx.score.hsptTaken,
  gpaRecorded: ctx => ctx.score.gpaRecorded,
  essayScored: ctx => ctx.score.essayScored,
  ready: ctx => ctx.score.hsptTaken && ctx.score.gpaRecorded && ctx.score.essayScored,
  gpaStatus: ctx => ctx.submission?.gpaStatus,
  gpaDpscd: ctx => ctx.submission?.gpaDpscd,
  gpaOptIn: ctx => ctx.submission?.gpaOptIn,
  roundKey: ctx => ctx.submission?.roundKey,
  roundName: ctx => ctx.submission?.roundName,
  currentStageId: ctx => ctx.submission?.currentStageId,
  currentStageName: ctx => ctx.submission?.currentStageName
}

/** field paths available per source, for UI + validation. */
export const MAPPING_SOURCE_FIELDS: Record<string, string[]> = {
  scoring: [
    'totalAppScore', 'totalMarygroveScore', 'exam.overall', 'exam.reading', 'exam.math', 'exam.language', 'exam.science',
    'gpa.raw', 'gpa.source', 'gpa.multiplier', 'gpa.score', 'gpa.bonus', 'essay.score', 'essay.reviewCount',
    'dpscdBonus', 'marygroveBonus', 'marygroveCatchment',
    'percentiles.total', 'percentiles.gpa', 'percentiles.essay', 'percentiles.exam',
    'percentiles.examReading', 'percentiles.examMath', 'percentiles.examLanguage', 'percentiles.examScience'
  ],
  hspt: [
    'overall', 'reading', 'math', 'language', 'science', 'rdrs', 'mtrs', 'lnrs', 'oprs',
    'rdnp', 'mtnp', 'lnnp', 'opnp', 'rdlp', 'mtlp', 'lnlp', 'oplp', 'rdge', 'mtge', 'lnge',
    'optCd', 'hpid', 'testCenter', 'batch', 'form', 'birth', 'matchType', 'sourceFile'
  ],
  gpa: [
    'resolvedCumulativeGpa', 'resolvedSource', 'gpaMultiplier', 'gpaBonusEligible', 'gpaBonus', 'gpaScore',
    'dpscd.cumulativeGpa', 'dpscd.quartersAvailable', 'dpscd.gpaStatus', 'dpscd.studentNumber', 'dpscd.middleSchoolNumber',
    'optIn.cumulativeGpa', 'optIn.schoolName', 'optIn.termsEnrolled', 'optIn.enrolledMinTerms'
  ],
  submission: [
    'submissionId', 'submissionIdInt', 'status', 'currentStageName', 'roundKey', 'roundName',
    'mappedFields.FullName', 'mappedFields.FirstName', 'mappedFields.LastName', 'mappedFields.DOB',
    'mappedFields.FirstChoiceSchool', 'mappedFields.SecondChoiceSchool', 'mappedFields.ThirdChoiceSchool',
    'mappedFields.FourthChoiceSchool', 'mappedFields.FifthChoiceSchool', 'mappedFields.StudentNumber',
    'mappedFields.DPSCD', 'mappedFields.GradeEntering', 'mappedFields.Address1', 'mappedFields.City',
    'mappedFields.State', 'mappedFields.Zip'
  ],
  placement: [],
  condition: Object.keys(CONDITION_EXTRACTORS),
  literal: []
}

const TEMPLATE_SOURCES: (keyof Pick<MappingContext, 'hspt' | 'gpa' | 'score' | 'submission'>)[] = ['hspt', 'gpa', 'score', 'submission']

export function expandLiteralTemplate(template: string, ctx: MappingContext): string {
  const now = ctx.now
  const date = now.toLocaleDateString('en-CA', { timeZone: 'America/Detroit' })
  const time = now.toLocaleTimeString('en-GB', { timeZone: 'America/Detroit', hour: '2-digit', minute: '2-digit', hour12: false })
  return template.replace(/\{\s*([^{}]+?)\s*\}/g, (match, raw: string) => {
    const token = raw.trim().toLowerCase()
    if (/^(today'?s?\s*_?date|today|date)$/.test(token)) return date
    if (token === 'time') return time
    if (token === 'datetime') return `${date} ${time}`
    const dotted = /^([a-z]+)\.(.+)$/.exec(token)
    if (dotted && TEMPLATE_SOURCES.includes(dotted[1] as never)) {
      const value = getPath(ctx[dotted[1] as 'hspt'], dotted[2]!)
      return value == null ? '' : String(value)
    }
    for (const source of TEMPLATE_SOURCES) {
      const value = getPath(ctx[source], token)
      if (value != null) return String(value)
    }
    return ''
  })
}

export function extractMappingValue(mapping: InternalFieldMapping, ctx: MappingContext): unknown {
  const field = mapping.field || ''
  if (mapping.source === 'literal') {
    const rendered = expandLiteralTemplate(field || String(mapping.default ?? ''), ctx)
    return rendered === '' ? mapping.default : rendered
  }
  let value: unknown
  switch (mapping.source) {
    case 'scoring':
      value = getPath(ctx.score, field)
      break
    case 'hspt':
      value = getPath(ctx.hspt, field)
      break
    case 'gpa':
      value = getPath(ctx.gpa, field)
      break
    case 'submission':
      value = getPath(ctx.submission, field)
      break
    case 'condition':
      value = CONDITION_EXTRACTORS[field]?.(ctx)
      break
    default:
      value = undefined
  }
  if (value === undefined || value === null) return mapping.default
  return value
}

interface FormFieldInfo {
  fieldType: string
  options: Map<string, string>
}

const SKIP_FIELD_TYPES = new Set(['divider', 'text_only', 'file_upload', 'table', 'cover_letter', 'reference_form', 'title', 'name', 'address', 'email', 'website', 'phone', 'date'])

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => sameValue(item, b[i]))
  }
  return a === b || (a == null && b == null)
}

function defaultValueForFieldType(fieldType: string): { value?: unknown, options?: string[] } {
  switch (fieldType) {
    case 'number': return { value: 0 }
    case 'single_checkbox': return { value: false }
    case 'single_response':
    case 'multiple_response': return { options: [] }
    case 'short_answer':
    case 'long_answer': return { value: '' }
    default: return { value: '' }
  }
}

export function mergeFieldData(
  fieldData: SubmittableFieldData[],
  updates: Map<string, { value: unknown, info: FormFieldInfo }>
): { fieldData: SubmittableFieldData[], changes: { formFieldId: string, before: unknown, after: unknown }[], warnings: string[] } {
  const changes: { formFieldId: string, before: unknown, after: unknown }[] = []
  const warnings: string[] = []
  const merged = fieldData.map((field) => {
    const update = updates.get(field.formFieldId)
    if (!update) return field
    const fieldType = (update.info.fieldType || field.fieldType || '').toLowerCase()
    const next = { ...field, fieldType }
    if (fieldType === 'single_response' || fieldType === 'multiple_response') {
      const label = String(update.value ?? 'None')
      const optionId = update.info.options.get(label.toLowerCase()) ?? update.info.options.get('none')
      if (!optionId) {
        warnings.push(`No option "${label}" on field ${field.formFieldId}`)
        return field
      }
      const after = [optionId]
      if (!sameValue(field.options, after)) {
        changes.push({ formFieldId: field.formFieldId, before: field.options, after })
        next.options = after
      }
      return next
    }
    const after = fieldType === 'number' ? (update.value == null ? 0 : Number(update.value)) : update.value
    if (!sameValue(field.value, after)) {
      changes.push({ formFieldId: field.formFieldId, before: field.value, after })
      next.value = after
    }
    return next
  })
  return { fieldData: merged, changes, warnings }
}

export function blankFieldData(formFields: { formFieldId: string, fieldType: string }[]): SubmittableFieldData[] {
  return formFields
    .filter(field => !SKIP_FIELD_TYPES.has(field.fieldType.toLowerCase()))
    .map(field => ({ formFieldId: field.formFieldId, fieldType: field.fieldType.toLowerCase(), ...defaultValueForFieldType(field.fieldType.toLowerCase()) }))
}

export interface InternalFormSyncResult {
  synced: number
  created: number
  unchanged: number
  skipped: number
  failures: { submissionId: string, error: string }[]
}

export async function syncInternalForms(options: {
  cycleId: string
  applicationId: string
  config: ScoringConfig
  actor: string
  jobId?: string
  dryRun?: boolean
  setProgress?: SetProgress
  submittable?: SubmittableClientConfig
}): Promise<InternalFormSyncResult> {
  const internalForm = options.config.internalForm
  const result: InternalFormSyncResult = { synced: 0, created: 0, unchanged: 0, skipped: 0, failures: [] }
  if (!internalForm?.formId || !Object.keys(internalForm.fields || {}).length) {
    const count = await ScoreRecordModel.countDocuments({ cycleId: options.cycleId, applicationId: options.applicationId })
    result.skipped = count
    return result
  }

  const form = await fetchForm(internalForm.formId, options.submittable)
  const fieldInfo = new Map<string, FormFieldInfo>()
  for (const field of form.fields) {
    fieldInfo.set(field.formFieldId, {
      fieldType: (field.fieldType || '').toLowerCase(),
      options: new Map((field.options || []).map(option => [option.label.trim().toLowerCase(), option.formOptionId]))
    })
  }

  const updates = new Map<string, { mapping: InternalFieldMapping, info: FormFieldInfo }>()
  for (const [formFieldId, mapping] of Object.entries(internalForm.fields || {})) {
    if (!mapping?.source) continue
    const info = fieldInfo.get(formFieldId)
    if (info) updates.set(formFieldId, { mapping, info })
  }

  const records = await ScoreRecordModel.find({ cycleId: options.cycleId, applicationId: options.applicationId }).sort({ submissionId: 1 }).lean()
  const submissionIds = records.map(record => record.submissionId)
  const [submissions, gpaRecords, hsptResults] = await Promise.all([
    SubmissionModel.find({ cycleId: options.cycleId, submissionId: { $in: submissionIds } }).lean(),
    GpaRecordModel.find({ cycleId: options.cycleId, submissionId: { $in: submissionIds } }).lean(),
    HSPTResultModel.find({ cycleId: options.cycleId, linkedSubmissionId: { $in: submissionIds }, status: 'linked' }).lean()
  ])
  const submissionById = new Map(submissions.map(item => [item.submissionId, item]))
  const gpaById = new Map(gpaRecords.map(item => [item.submissionId, item]))
  const hsptById = new Map(hsptResults.map(item => [item.linkedSubmissionId!, item]))
  await options.setProgress?.({ phase: 'syncing_internal_forms', processed: 0, total: records.length, message: `Writing ${records.length} internal form entries` })

  await mapWithConcurrency(records, 3, async (record, index) => {
    const submissionId = record.submissionId
    const markStatus = async (status: string, error?: string) => {
      if (options.dryRun) return
      await ScoreRecordModel.updateOne(
        { cycleId: options.cycleId, applicationId: options.applicationId, submissionId },
        { $set: { internalFormSyncStatus: status, internalFormSyncError: error, internalFormSyncedAt: error ? undefined : new Date() } }
      )
    }

    try {
      const ctx: MappingContext = {
        score: record,
        submission: submissionById.get(submissionId) as Submission | undefined,
        gpa: gpaById.get(submissionId) as GpaRecord | undefined,
        hspt: hsptById.get(submissionId) as HSPTResult | undefined,
        now: new Date()
      }
      const perField = new Map<string, { value: unknown, info: FormFieldInfo }>()
      for (const [formFieldId, { mapping, info }] of updates) {
        perField.set(formFieldId, { value: extractMappingValue(mapping, ctx), info })
      }

      const entries = await fetchSubmissionEntries(submissionId, options.submittable)
      const internalEntry = entries.find(entry => entry.formType === 'internal')
      const entryId = internalEntry?.entryId || internalEntry?.entry?.entryId

      if (!entryId) {
        const fieldData = blankFieldData(form.fields)
        mergeFieldData(fieldData, perField)
        if (!options.dryRun) await createInternalFormEntry(submissionId, fieldData, options.submittable)
        result.created += 1
        await markStatus('synced')
      } else {
        const existing = await fetchEntry(entryId, options.submittable)
        const { fieldData, changes, warnings } = mergeFieldData(existing.fieldData, perField)
        if (!changes.length && !warnings.length) {
          result.unchanged += 1
          await markStatus('unchanged')
        } else {
          if (!options.dryRun) {
            if (changes.length) await updateInternalFormEntry(entryId, fieldData, options.submittable)
            await AuditLogModel.insertMany(changes.map(change => ({
              action: 'internal_form_update',
              actor: options.actor,
              cycleId: options.cycleId,
              applicationId: options.applicationId,
              entityType: 'submission',
              entityId: submissionId,
              changes: [{ path: `internalForm.${change.formFieldId}`, before: change.before, after: change.after }]
            })))
          }
          result.synced += 1
          await markStatus(warnings.length ? 'failed' : 'synced', warnings.join('; ') || undefined)
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      result.failures.push({ submissionId, error: message })
      await markStatus('failed', message)
    }
    await options.setProgress?.({ phase: 'syncing_internal_forms', processed: index + 1, total: records.length })
  })

  return result
}
