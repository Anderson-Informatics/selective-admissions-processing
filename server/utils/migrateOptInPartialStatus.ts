import { ApplicationModel } from '../models/Application'
import { ReviewStageModel } from '../models/ReviewStage'
import { SubmissionModel } from '../models/Submission'
import { LEGACY_OPT_IN_PARTIAL_STATUS, OPT_IN_PARTIAL_STATUS } from './routingEvaluator'

function rewriteLegacyStatus(value: unknown): { value: unknown, changed: boolean } {
  if (value === LEGACY_OPT_IN_PARTIAL_STATUS) return { value: OPT_IN_PARTIAL_STATUS, changed: true }
  if (Array.isArray(value)) {
    let changed = false
    const rewritten = value.map((item) => {
      const result = rewriteLegacyStatus(item)
      changed ||= result.changed
      return result.value
    })
    return { value: rewritten, changed }
  }
  if (!value || typeof value !== 'object' || value instanceof Date) return { value, changed: false }
  let changed = false
  const rewritten: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    const result = rewriteLegacyStatus(item)
    changed ||= result.changed
    rewritten[key] = result.value
  }
  return { value: rewritten, changed }
}

export async function migrateOptInPartialStatus() {
  const submissionResult = await SubmissionModel.updateMany(
    { gpaStatus: LEGACY_OPT_IN_PARTIAL_STATUS },
    { $set: { gpaStatus: OPT_IN_PARTIAL_STATUS } }
  )

  let routingUpdated = 0
  const stages = await ReviewStageModel.find({}).select('routing routingDraft').lean()
  for (const stage of stages) {
    const routing = rewriteLegacyStatus(stage.routing)
    const routingDraft = rewriteLegacyStatus(stage.routingDraft)
    const update: Record<string, unknown> = {}
    if (routing.changed) update.routing = routing.value
    if (routingDraft.changed) update.routingDraft = routingDraft.value
    if (Object.keys(update).length) {
      await ReviewStageModel.updateOne({ _id: stage._id }, { $set: update })
      routingUpdated += 1
    }
  }

  let dashboardUpdated = 0
  const applications = await ApplicationModel.find({ dashboard: { $exists: true } }).select('dashboard').lean()
  for (const application of applications) {
    const dashboard = rewriteLegacyStatus(application.dashboard)
    if (dashboard.changed) {
      await ApplicationModel.updateOne({ _id: application._id }, { $set: { dashboard: dashboard.value } })
      dashboardUpdated += 1
    }
  }

  if (submissionResult.modifiedCount || routingUpdated || dashboardUpdated) {
    console.log(`Migrated ${LEGACY_OPT_IN_PARTIAL_STATUS} to ${OPT_IN_PARTIAL_STATUS}: ${submissionResult.modifiedCount} submissions, ${routingUpdated} stages, ${dashboardUpdated} dashboards`)
  }
  return { submissions: submissionResult.modifiedCount, stages: routingUpdated, dashboards: dashboardUpdated }
}
