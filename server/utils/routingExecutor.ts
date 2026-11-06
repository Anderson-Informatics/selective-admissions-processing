import type { AnyBulkWriteOperation } from 'mongoose'
import type { JobProgress } from '../models/Job'
import { AuditLogModel } from '../models/AuditLog'
import { MessageTemplateModel, type MessageTemplate } from '../models/MessageTemplate'
import { ReviewStageModel } from '../models/ReviewStage'
import { SubmissionModel, type Submission } from '../models/Submission'
import { mapWithConcurrency } from './concurrency'
import { evaluateCycleSubmissions, loadListOptionLabels, type SubmissionEvaluation } from './routingRun'
import { renderMergeFields, resolveRoutingActions, type ResolvedRoutingActions } from './routingActions'
import {
  addSubmissionLabelBulk,
  assignSubmissionReviewers,
  closeSubmissionsForEditing,
  fetchSubmissionsForProject,
  moveSubmissionToStage,
  moveSubmissionsToStage,
  openSubmissionsForEditing,
  removeSubmissionLabel,
  type SubmittableClientConfig
} from './submittable'

type ProgressFn = (update: Partial<JobProgress>) => Promise<void>

export interface RoutingExecutionOptions {
  cycleId: string
  applicationId?: string
  labelId?: string
  limit?: number
  excludeSubmissionIds?: string[]
  dryRun?: boolean
  actor: string
  jobId?: string
  setProgress?: ProgressFn
  submittable?: SubmittableClientConfig
}

export interface RoutingExecutionFailure {
  submissionId: string
  step: string
  error: string
}

export interface RoutingExecutionResult {
  evaluated: number
  moves: number
  noAction: number
  backwardMoves: number
  dryRun: boolean
  actionsApplied: {
    labelsAdded: number
    labelsRemoved: number
    assignments: number
    statusLabelsSynced: number
    openedForEditing: number
    closedForEditing: number
  }
  movedSubmissions: Array<Record<string, unknown>>
  failures: RoutingExecutionFailure[]
  diagnostics: Array<Record<string, unknown>>
}

interface EvaluatedSubmission extends SubmissionEvaluation {
  actions: ResolvedRoutingActions
}

async function refreshCurrentStages(
  cycleId: string,
  submissions: Submission[],
  setProgress?: ProgressFn,
  clientConfig?: SubmittableClientConfig
) {
  const projectIds = [...new Set(submissions.map(submission => submission.projectId).filter((id): id is string => Boolean(id)))]
  const targetIds = new Set(submissions.map(submission => submission.submissionId))
  const stages = await ReviewStageModel.find({ cycleId }).lean()
  const stageNameByKey = new Map(stages.map(stage => [`${String(stage.applicationId)}|${stage.stageId}`, stage.name]))

  const remote = new Map<string, { stageId?: string, status?: string, labels?: string[] }>()
  await mapWithConcurrency(projectIds, 3, async (projectId) => {
    const items = await fetchSubmissionsForProject(projectId, clientConfig)
    for (const item of items) {
      if (!targetIds.has(item.submissionId)) continue
      remote.set(item.submissionId, { stageId: item.reviewStageId, status: item.status, labels: item.labels })
    }
  })

  const applicationIdBySubmission = new Map(submissions.map(submission => [submission.submissionId, String(submission.applicationId)]))
  const operations: AnyBulkWriteOperation<Submission>[] = []
  for (const [submissionId, data] of remote) {
    const set: Record<string, unknown> = {}
    if (data.stageId) {
      set.currentStageId = data.stageId
      set.currentStageName = stageNameByKey.get(`${applicationIdBySubmission.get(submissionId)}|${data.stageId}`) || ''
    }
    if (data.status) set.status = data.status
    if (data.labels) set.labelIds = data.labels
    if (Object.keys(set).length) {
      operations.push({ updateOne: { filter: { submissionId }, update: { $set: set } } })
    }
  }
  if (operations.length) await SubmissionModel.bulkWrite(operations)
  await setProgress?.({ message: `Refreshed current stages for ${operations.length} submissions` })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function executeRoutingRun(options: RoutingExecutionOptions): Promise<RoutingExecutionResult> {
  const setProgress = options.setProgress || (async () => {})
  const dryRun = options.dryRun === true
  const excluded = new Set(options.excludeSubmissionIds || [])

  const result: RoutingExecutionResult = {
    evaluated: 0,
    moves: 0,
    noAction: 0,
    backwardMoves: 0,
    dryRun,
    actionsApplied: {
      labelsAdded: 0,
      labelsRemoved: 0,
      assignments: 0,
      statusLabelsSynced: 0,
      openedForEditing: 0,
      closedForEditing: 0
    },
    movedSubmissions: [],
    failures: [],
    diagnostics: []
  }

  // Stale-stage recheck: refresh the local mirror of each in-scope submission's
  // current stage from Submittable before evaluating.
  const inScopeFilter: Record<string, unknown> = { cycleId: options.cycleId }
  if (options.applicationId) inScopeFilter.applicationId = options.applicationId
  if (options.labelId) inScopeFilter.labelIds = options.labelId
  const scoped = await SubmissionModel.find(inScopeFilter).select('submissionId projectId applicationId').limit(2000).lean()
  if (scoped.length) {
    await setProgress({ phase: 'refreshing_stages', processed: 0, total: scoped.length, percent: 0, message: 'Refreshing current stages from Submittable' })
    await refreshCurrentStages(options.cycleId, scoped as Submission[], setProgress, options.submittable)
  }

  const evaluation = await evaluateCycleSubmissions({
    cycleId: options.cycleId,
    applicationId: options.applicationId,
    labelId: options.labelId,
    limit: options.limit,
    maxLimit: 5000
  })
  const evaluated: EvaluatedSubmission[] = evaluation.submissions
    .filter(item => !excluded.has(item.submission.submissionId))
    .map(item => ({
      ...item,
      actions: resolveRoutingActions(item.stages, item.context, item.decision, item.completion.reviewCompletion)
    }))

  result.evaluated = evaluated.length
  for (const item of evaluated) {
    if (item.decision.action === 'stay') result.noAction += 1
    if (item.decision.backward) result.backwardMoves += 1
    result.diagnostics.push(...item.decision.diagnostics.map(diagnostic => ({
      submissionId: item.submission.submissionId,
      ...diagnostic
    })))
    result.diagnostics.push(...item.actions.diagnostics.map(diagnostic => ({
      submissionId: item.submission.submissionId,
      ...diagnostic
    })))
  }

  const movers = evaluated.filter(item => item.actions.move?.toStageId)
  result.moves = movers.length

  // Load referenced message templates once.
  const templateIds = [...new Set(evaluated.flatMap(item => [
    item.actions.openForEditing?.templateId,
    item.actions.closeForEditing?.templateId
  ].filter((id): id is string => Boolean(id))))]
  const templates = new Map<string, MessageTemplate>()
  if (templateIds.length) {
    const docs = await MessageTemplateModel.find({ _id: { $in: templateIds } }).lean()
    for (const doc of docs) templates.set(String(doc._id), doc as MessageTemplate)
    for (const id of templateIds) {
      if (!templates.has(id)) {
        result.diagnostics.push({ code: 'missing_template', message: `Message template ${id} was not found; editing action skipped.` })
      }
    }
  }

  await setProgress({
    phase: dryRun ? 'evaluated' : 'executing',
    processed: 0,
    total: movers.length,
    percent: movers.length ? 0 : 100,
    message: dryRun
      ? `Dry run: ${movers.length} moves, ${result.noAction} unchanged`
      : `Executing ${movers.length} moves`
  })
  if (dryRun) return result

  // Stage moves — bulk per target stage, falling back to per-submission on batch failure.
  const movesByStage = new Map<string, EvaluatedSubmission[]>()
  for (const item of movers) {
    const stageId = item.actions.move!.toStageId!
    const list = movesByStage.get(stageId) || []
    list.push(item)
    movesByStage.set(stageId, list)
  }
  const movedIds = new Set<string>()
  let processed = 0
  for (const [stageId, items] of movesByStage) {
    const stageName = items[0] ? evaluation.stageNameById.get(stageId) : undefined
    try {
      await moveSubmissionsToStage(stageId, items.map(item => item.submission.submissionId), options.submittable)
      items.forEach(item => movedIds.add(item.submission.submissionId))
    } catch (error) {
      for (const item of items) {
        try {
          await moveSubmissionToStage(item.submission.submissionId, stageId, options.submittable)
          movedIds.add(item.submission.submissionId)
        } catch (innerError) {
          result.failures.push({ submissionId: item.submission.submissionId, step: 'stage_move', error: errorMessage(innerError) })
        }
      }
      result.diagnostics.push({ code: 'bulk_move_fallback', message: `Bulk move to ${stageName || stageId} failed; fell back to per-submission moves. ${errorMessage(error)}` })
    }
    processed += items.length
    await setProgress({ phase: 'executing', processed, total: movers.length, message: `Moved ${processed} / ${movers.length} submissions` })
  }

  // Label and assignment side effects only apply to submissions whose move succeeded.
  const moved = evaluated.filter(item => movedIds.has(item.submission.submissionId))
  const labelChangeBySubmission = new Map<string, { add: Set<string>, remove: Set<string> }>()
  const recordLabelChange = (submissionId: string, add: string[], remove: string[]) => {
    const entry = labelChangeBySubmission.get(submissionId) || { add: new Set<string>(), remove: new Set<string>() }
    add.forEach(id => entry.add.add(id))
    remove.forEach(id => entry.remove.add(id))
    labelChangeBySubmission.set(submissionId, entry)
  }
  const labelsToApply = new Map<string, string[]>()
  for (const item of moved) {
    for (const labelId of item.actions.labelsToAdd) {
      const list = labelsToApply.get(labelId) || []
      list.push(item.submission.submissionId)
      labelsToApply.set(labelId, list)
    }
  }
  // statusLabels sync applies to all evaluated submissions, not only moved ones.
  for (const item of evaluated) {
    if (item.actions.move?.toStageId) continue
    for (const labelId of item.actions.statusLabelIds) {
      const list = labelsToApply.get(labelId) || []
      list.push(item.submission.submissionId)
      labelsToApply.set(labelId, list)
    }
  }
  for (const [labelId, submissionIds] of labelsToApply) {
    try {
      await addSubmissionLabelBulk(submissionIds, labelId, options.submittable)
      result.actionsApplied.labelsAdded += submissionIds.length
      for (const submissionId of submissionIds) recordLabelChange(submissionId, [labelId], [])
    } catch (error) {
      for (const submissionId of submissionIds) {
        result.failures.push({ submissionId, step: 'label_add', error: errorMessage(error) })
      }
    }
  }

  const labelRemovals: Array<{ submissionId: string, labelId: string }> = []
  for (const item of moved) {
    for (const labelId of item.actions.labelsToRemove) labelRemovals.push({ submissionId: item.submission.submissionId, labelId })
  }
  for (const item of evaluated) {
    if (item.actions.move?.toStageId) continue
    for (const labelId of item.actions.labelsToRemove) {
      labelRemovals.push({ submissionId: item.submission.submissionId, labelId })
    }
  }
  for (const removal of labelRemovals) {
    try {
      await removeSubmissionLabel(removal.submissionId, removal.labelId, options.submittable)
      result.actionsApplied.labelsRemoved += 1
      recordLabelChange(removal.submissionId, [], [removal.labelId])
    } catch (error) {
      result.failures.push({ submissionId: removal.submissionId, step: 'label_remove', error: errorMessage(error) })
    }
  }

  const assignmentGroups = new Map<string, { assign: string[], unassign: string[], submissionIds: string[] }>()
  for (const item of moved) {
    const { assignUserIds, unassignUserIds } = item.actions
    if (!assignUserIds.length && !unassignUserIds.length) continue
    const key = `${[...assignUserIds].sort().join(',')}::${[...unassignUserIds].sort().join(',')}`
    const group = assignmentGroups.get(key) || { assign: assignUserIds, unassign: unassignUserIds, submissionIds: [] }
    group.submissionIds.push(item.submission.submissionId)
    assignmentGroups.set(key, group)
  }
  for (const group of assignmentGroups.values()) {
    try {
      await assignSubmissionReviewers({
        submissionIds: group.submissionIds,
        assignTeamMemberUserIds: group.assign,
        unAssignTeamMemberUserIds: group.unassign
      }, options.submittable)
      result.actionsApplied.assignments += group.submissionIds.length
    } catch (error) {
      for (const submissionId of group.submissionIds) {
        result.failures.push({ submissionId, step: 'assignment', error: errorMessage(error) })
      }
    }
  }

  // Open/close for editing — grouped by identical rendered content.
  const hasEditingActions = moved.some(item => item.actions.openForEditing || item.actions.closeForEditing)
  const optionLabels = hasEditingActions ? await loadListOptionLabels(options.cycleId) : {}
  const editingGroups = new Map<string, { kind: 'open' | 'close', subject: string, body: string, internalNote?: string, submissionIds: string[] }>()
  for (const item of moved) {
    for (const kind of ['open', 'close'] as const) {
      const config = kind === 'open' ? item.actions.openForEditing : item.actions.closeForEditing
      if (!config) continue
      if (config.templateId && !templates.has(config.templateId)) continue
      const template = config.templateId ? templates.get(config.templateId) : undefined
      const subjectSource = template?.subject ?? config.subjectTemplate ?? ''
      const bodySource = template?.bodyHtml ?? config.messageTemplate ?? ''
      const subject = renderMergeFields(subjectSource, item.context, { optionLabels })
      const body = renderMergeFields(bodySource, item.context, { mode: 'html', optionLabels })
      const internalNote = config.internalNoteTemplate ? renderMergeFields(config.internalNoteTemplate, item.context, { optionLabels }).text : undefined
      for (const token of [...subject.unresolved, ...body.unresolved]) {
        result.diagnostics.push({ submissionId: item.submission.submissionId, code: 'unresolved_merge_field', message: `Merge field {{${token}}} had no value` })
      }
      for (const token of new Set([...subject.unknownFormats, ...body.unknownFormats])) {
        result.diagnostics.push({ submissionId: item.submission.submissionId, code: 'unknown_merge_format', message: `Unknown merge field format in {{${token}}}; rendered as raw text` })
      }
      const key = `${kind}::${subject.text}::${body.text}::${internalNote || ''}`
      const group = editingGroups.get(key) || { kind, subject: subject.text, body: body.text, internalNote, submissionIds: [] }
      group.submissionIds.push(item.submission.submissionId)
      editingGroups.set(key, group)
    }
  }
  for (const group of editingGroups.values()) {
    try {
      if (group.kind === 'open') {
        await openSubmissionsForEditing({ submissionIds: group.submissionIds, internalNote: group.internalNote, subject: group.subject, body: group.body }, options.submittable)
        result.actionsApplied.openedForEditing += group.submissionIds.length
      } else {
        await closeSubmissionsForEditing({ submissionIds: group.submissionIds, internalNote: group.internalNote, subject: group.subject, body: group.body }, options.submittable)
        result.actionsApplied.closedForEditing += group.submissionIds.length
      }
    } catch (error) {
      for (const submissionId of group.submissionIds) {
        result.failures.push({ submissionId, step: group.kind === 'open' ? 'open_for_editing' : 'close_for_editing', error: errorMessage(error) })
      }
    }
  }

  // Local state updates for successfully moved submissions.
  const now = new Date()
  const updateOps: AnyBulkWriteOperation<Submission>[] = []
  const auditDocs = []
  const movedSubmissionIds = new Set(moved.map(item => item.submission.submissionId))
  for (const item of evaluated) {
    if (movedSubmissionIds.has(item.submission.submissionId)) continue
    const change = labelChangeBySubmission.get(item.submission.submissionId)
    if (!change) continue
    const appliedLabels = new Set(item.submission.labelIds || [])
    change.add.forEach(id => appliedLabels.add(id))
    change.remove.forEach(id => appliedLabels.delete(id))
    updateOps.push({
      updateOne: {
        filter: { submissionId: item.submission.submissionId },
        update: { $set: { labelIds: [...appliedLabels] } }
      }
    })
  }
  for (const item of moved) {
    const move = item.actions.move!
    const toStageName = evaluation.stageNameById.get(move.toStageId!) || ''
    const change = labelChangeBySubmission.get(item.submission.submissionId)
    const appliedLabels = new Set(item.submission.labelIds || [])
    change?.add.forEach(id => appliedLabels.add(id))
    change?.remove.forEach(id => appliedLabels.delete(id))
    updateOps.push({
      updateOne: {
        filter: { submissionId: item.submission.submissionId },
        update: {
          $set: {
            currentStageId: move.toStageId,
            currentStageName: toStageName,
            labelIds: [...appliedLabels]
          },
          $push: {
            routingHistory: {
              fromStageId: move.fromStageId,
              fromStageName: move.fromStageId ? evaluation.stageNameById.get(move.fromStageId) : item.submission.currentStageName,
              toStageId: move.toStageId,
              toStageName,
              reason: move.reason,
              backward: move.backward,
              jobId: options.jobId,
              at: now,
              actionsApplied: {
                labelsAdded: item.actions.labelsToAdd,
                labelsRemoved: item.actions.labelsToRemove,
                assignUserIds: item.actions.assignUserIds,
                unassignUserIds: item.actions.unassignUserIds,
                openedForEditing: Boolean(item.actions.openForEditing),
                closedForEditing: Boolean(item.actions.closeForEditing)
              }
            }
          }
        }
      }
    })
    auditDocs.push({
      action: 'routing_move',
      actor: options.actor,
      cycleId: options.cycleId,
      applicationId: String(item.submission.applicationId),
      entityType: 'submission',
      entityId: item.submission.submissionId,
      changes: [{ path: 'currentStageId', before: move.fromStageId, after: move.toStageId }]
    })
    result.movedSubmissions.push({
      submissionId: item.submission.submissionId,
      applicantName: item.applicantName,
      applicationName: item.applicationName,
      fromStage: item.submission.currentStageName || (move.fromStageId ? evaluation.stageNameById.get(move.fromStageId) : 'Unknown'),
      toStage: toStageName,
      reason: move.reason,
      backward: move.backward
    })
  }
  if (updateOps.length) await SubmissionModel.bulkWrite(updateOps)
  if (auditDocs.length) await AuditLogModel.insertMany(auditDocs)

  result.actionsApplied.statusLabelsSynced = evaluated.filter(item => item.actions.statusLabelSync).length
  const failedMoves = movers.length - movedIds.size
  await setProgress({
    phase: 'completed',
    processed: movers.length,
    total: movers.length,
    percent: 100,
    message: `Routing complete: ${movedIds.size} moved${failedMoves ? `, ${failedMoves} failed` : ''}, ${result.failures.length} side-effect failures`
  })
  return result
}
