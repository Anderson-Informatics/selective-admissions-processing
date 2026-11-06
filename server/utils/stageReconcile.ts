import type { AnyBulkWriteOperation } from 'mongoose'
import { ApplicationModel, type Application } from '../models/Application'
import { ReviewModel, type Review } from '../models/Review'
import { ReviewStageModel, type ReviewStage } from '../models/ReviewStage'
import { SubmissionModel, type Submission } from '../models/Submission'
import { recordConfigAudit } from './configAudit'
import { normalizeRoutingConfig, rewriteReferencedStageIds } from './routingConfig'
import type { SubmittableProject, SubmittableReviewStage } from './submittable'

export interface StageRemap {
  fromStageId: string
  toStageId: string
  matchedBy: 'order' | 'name' | 'formId'
  name: string
}

export interface StageReconcileReport {
  applicationId: string
  applicationName: string
  projectId: string
  remapped: StageRemap[]
  ambiguous: Array<{ localStageId: string, localName: string, candidateStageIds: string[] }>
  orphanStageIds: string[]
  newRemoteStages: Array<{ stageId: string, name: string }>
  submissionsOnOrphanStages: number
}

type LocalStage = Pick<ReviewStage, 'stageId' | 'name' | 'type' | 'formId' | 'order'>

function remoteOrder(stage: SubmittableReviewStage, index: number): number {
  return typeof stage.stageOrder === 'number' ? stage.stageOrder : index
}

/**
 * Diff local ReviewStage docs against Submittable's current reviewStages for a project.
 * Only unambiguous old→new matches become remaps; anything else is reported.
 */
export function diffStages(
  localStages: LocalStage[],
  remoteStages: SubmittableReviewStage[]
): Pick<StageReconcileReport, 'remapped' | 'ambiguous' | 'orphanStageIds' | 'newRemoteStages'> {
  const remapped: StageRemap[] = []
  const ambiguous: StageReconcileReport['ambiguous'] = []
  const orphanStageIds: string[] = []

  const remoteById = new Map(remoteStages.map(stage => [stage.reviewStageId, stage]))
  const remoteWithOrder = remoteStages.map((stage, index) => ({ stage, order: remoteOrder(stage, index) }))
  const localIds = new Set(localStages.map(stage => stage.stageId))
  const matchedRemoteIds = new Set(remoteStages.filter(stage => localIds.has(stage.reviewStageId)).map(stage => stage.reviewStageId))
  const missingLocal = localStages.filter(local => !remoteById.has(local.stageId))
  const unmatchedRemote = () => remoteWithOrder.filter(item => !matchedRemoteIds.has(item.stage.reviewStageId))

  for (const local of missingLocal) {
    const pool = unmatchedRemote()
    const byOrder = pool.filter(item => item.order === local.order)
    const byName = pool.filter(item => item.stage.stageName === local.name)
    const byForm = local.formId ? pool.filter(item => item.stage.formId === local.formId) : []

    let match: { stage: SubmittableReviewStage, matchedBy: StageRemap['matchedBy'] } | undefined
    if (byOrder.length === 1) match = { stage: byOrder[0]!.stage, matchedBy: 'order' }
    else if (byName.length === 1) match = { stage: byName[0]!.stage, matchedBy: 'name' }
    else if (byForm.length === 1) match = { stage: byForm[0]!.stage, matchedBy: 'formId' }

    if (match) {
      matchedRemoteIds.add(match.stage.reviewStageId)
      remapped.push({ fromStageId: local.stageId, toStageId: match.stage.reviewStageId, matchedBy: match.matchedBy, name: match.stage.stageName })
      continue
    }

    const candidates = [...new Set([...byOrder, ...byName, ...byForm].map(item => item.stage.reviewStageId))]
    if (candidates.length) ambiguous.push({ localStageId: local.stageId, localName: local.name, candidateStageIds: candidates })
    else orphanStageIds.push(local.stageId)
  }

  const newRemoteStages = unmatchedRemote().map(item => ({ stageId: item.stage.reviewStageId, name: item.stage.stageName }))
  return { remapped, ambiguous, orphanStageIds, newRemoteStages }
}

interface DashboardMetric {
  type?: string
  stageId?: string
}

interface DashboardHighlight {
  metric?: DashboardMetric
  segments?: Array<{ metric?: DashboardMetric }>
}

function rewriteDashboardStageIds(application: Application, remap: ReadonlyMap<string, string>): boolean {
  const highlights = (application.dashboard?.highlights || []) as DashboardHighlight[]
  let changed = false
  const rewrite = (metric?: DashboardMetric) => {
    if (metric?.type === 'reviewStage' && typeof metric.stageId === 'string' && remap.has(metric.stageId)) {
      metric.stageId = remap.get(metric.stageId)!
      changed = true
    }
  }
  for (const highlight of highlights) {
    rewrite(highlight.metric)
    for (const segment of highlight.segments || []) rewrite(segment.metric)
  }
  return changed
}

/**
 * Reconcile each application's ReviewStage docs against the remote project stage list,
 * rewriting stale stageIds in place across stage docs, reviews, submissions, routing
 * configs (published and draft), and dashboard metrics. Unambiguous matches only —
 * ambiguous and orphaned cases are reported, never guessed.
 */
export async function applyStageReconcile(
  cycleId: string,
  remoteProjects: SubmittableProject[],
  actor: string
): Promise<{ reports: StageReconcileReport[], remappedCount: number }> {
  const applications = await ApplicationModel.find({ cycleId }).lean()
  const projectById = new Map(remoteProjects.map(project => [project.projectId, project]))
  const reports: StageReconcileReport[] = []
  let remappedCount = 0

  for (const application of applications) {
    const remote = projectById.get(application.projectId)
    if (!remote || !Array.isArray(remote.reviewStages)) continue

    const stageDocs = await ReviewStageModel.find({ applicationId: String(application._id) }).sort({ order: 1 })
    const diff = diffStages(stageDocs, remote.reviewStages)
    const orphanSubmissions = diff.orphanStageIds.length
      ? await SubmissionModel.countDocuments({ applicationId: String(application._id), currentStageId: { $in: diff.orphanStageIds } })
      : 0

    const report: StageReconcileReport = {
      applicationId: String(application._id),
      applicationName: application.name,
      projectId: application.projectId,
      remapped: diff.remapped,
      ambiguous: diff.ambiguous,
      orphanStageIds: diff.orphanStageIds,
      newRemoteStages: diff.newRemoteStages,
      submissionsOnOrphanStages: orphanSubmissions
    }
    reports.push(report)
    if (!diff.remapped.length) continue

    const remap = new Map(diff.remapped.map(item => [item.fromStageId, item.toStageId]))
    const remoteById = new Map(remote.reviewStages.map((stage, index) => [stage.reviewStageId, { stage, order: remoteOrder(stage, index) }]))

    // Rewrite stageId references inside routing configs (published + draft) for every
    // stage in the application — conditions can reference sibling stages.
    const stageWrites: AnyBulkWriteOperation<ReviewStage>[] = []
    for (const doc of stageDocs) {
      const $set: Record<string, unknown> = {}
      const remoteMatch = remoteById.get(remap.get(doc.stageId) || doc.stageId)
      if (remoteMatch) {
        const { stage, order } = remoteMatch
        if (remap.has(doc.stageId)) $set.stageId = stage.reviewStageId
        if (stage.stageName && stage.stageName !== doc.name) $set.name = stage.stageName
        if (stage.type && stage.type !== doc.type) $set.type = stage.type
        if (stage.formId !== doc.formId) $set.formId = stage.formId
        if (order !== doc.order) $set.order = order
      }
      const normalizedRouting = doc.routing ? normalizeRoutingConfig(doc.routing) : undefined
      const routing = normalizedRouting ? rewriteReferencedStageIds(normalizedRouting, remap) : undefined
      const normalizedDraft = doc.routingDraft ? normalizeRoutingConfig(doc.routingDraft) : undefined
      const routingDraft = normalizedDraft ? rewriteReferencedStageIds(normalizedDraft, remap) : undefined
      if (routing && routing !== normalizedRouting) $set.routing = routing
      if (routingDraft && routingDraft !== normalizedDraft) $set.routingDraft = routingDraft
      if (Object.keys($set).length) stageWrites.push({ updateOne: { filter: { _id: doc._id }, update: { $set } } })
    }
    if (stageWrites.length) await ReviewStageModel.bulkWrite(stageWrites)

    const reviewOps = diff.remapped.map(item => ({
      updateMany: { filter: { applicationId: String(application._id), stageId: item.fromStageId }, update: { $set: { stageId: item.toStageId } } }
    })) as AnyBulkWriteOperation<Review>[]
    await ReviewModel.bulkWrite(reviewOps)

    const newNameById = new Map(remote.reviewStages.map(stage => [stage.reviewStageId, stage.stageName]))
    const submissionOps = diff.remapped.map(item => ({
      updateMany: {
        filter: { applicationId: String(application._id), currentStageId: item.fromStageId },
        update: { $set: { currentStageId: item.toStageId, currentStageName: newNameById.get(item.toStageId) || '' } }
      }
    })) as AnyBulkWriteOperation<Submission>[]
    await SubmissionModel.bulkWrite(submissionOps)

    if (rewriteDashboardStageIds(application, remap)) {
      await ApplicationModel.updateOne({ _id: application._id }, { $set: { dashboard: application.dashboard } })
    }

    await recordConfigAudit({
      actor,
      cycleId,
      applicationId: String(application._id),
      entityId: String(application._id),
      before: { remappedStageIds: diff.remapped.map(item => item.fromStageId) },
      after: { remappedStageIds: diff.remapped.map(item => item.toStageId) }
    })
    remappedCount += diff.remapped.length
  }

  return { reports, remappedCount }
}
