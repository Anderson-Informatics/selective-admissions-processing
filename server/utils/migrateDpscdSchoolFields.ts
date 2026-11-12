import { ApplicationModel } from '../models/Application'
import { GpaRecordModel } from '../models/GpaRecord'

const LEGACY_SCHOOL_FIELD = 'dpscd.middleSchoolNumber'
const SCHOOL_FIELD = 'dpscd.schoolNumber'

function rewriteFieldPath(value: unknown): { value: unknown, changed: boolean } {
  if (value === LEGACY_SCHOOL_FIELD) return { value: SCHOOL_FIELD, changed: true }
  if (Array.isArray(value)) {
    let changed = false
    const rewritten = value.map((item) => {
      const result = rewriteFieldPath(item)
      changed ||= result.changed
      return result.value
    })
    return { value: rewritten, changed }
  }
  if (!value || typeof value !== 'object' || value instanceof Date) return { value, changed: false }
  let changed = false
  const rewritten: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    const result = rewriteFieldPath(item)
    changed ||= result.changed
    rewritten[key] = result.value
  }
  return { value: rewritten, changed }
}

export async function migrateDpscdSchoolFields() {
  const recordResult = await GpaRecordModel.updateMany(
    { [LEGACY_SCHOOL_FIELD]: { $exists: true } },
    [
      { $set: { [SCHOOL_FIELD]: { $ifNull: [`$${SCHOOL_FIELD}`, `$${LEGACY_SCHOOL_FIELD}`] } } },
      { $unset: LEGACY_SCHOOL_FIELD }
    ],
    { updatePipeline: true }
  )

  let applications = 0
  const records = await ApplicationModel.find({}).select('scoring').lean()
  for (const application of records) {
    const scoring = rewriteFieldPath(application.scoring)
    if (!scoring.changed) continue
    await ApplicationModel.updateOne({ _id: application._id }, { $set: { scoring: scoring.value } })
    applications += 1
  }

  return { records: recordResult.modifiedCount || 0, applications }
}
