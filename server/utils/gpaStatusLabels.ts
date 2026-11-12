import { ApplicationModel, type Application } from '../models/Application'
import type { JobProgress } from '../models/Job'
import { SubmissionModel, type Submission } from '../models/Submission'
import { canonicalGpaStatus } from './routingEvaluator'
import { addSubmissionLabelBulk, removeSubmissionLabel, type SubmittableClientConfig } from './submittable'

export interface GpaStatusLabelSyncOptions {
  cycleId: string
  applicationId?: string
  dryRun?: boolean
  setProgress?: (progress: Partial<JobProgress>) => Promise<void>
  submittable?: SubmittableClientConfig
}

export interface GpaStatusLabelSyncFailure {
  applicationId?: string
  applicationName?: string
  submissionId?: string
  operation: 'configuration' | 'add' | 'remove'
  error: string
}

export interface GpaStatusLabelSyncResult {
  dryRun: boolean
  applications: number
  applicationsSkipped: number
  applicationsFailed: number
  submissions: number
  labelsAdded: number
  labelsRemoved: number
  unchanged: number
  skipped: number
  failures: GpaStatusLabelSyncFailure[]
}

function configuredLabels(scoring: Application['scoring']): Record<string, string> {
  const raw = (scoring && typeof scoring === 'object' && !Array.isArray(scoring)
    ? (scoring as Record<string, unknown>).gpaStatusLabels
    : undefined)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>)
      .filter(([status, labelId]) => status.trim() !== '' && typeof labelId === 'string' && labelId.trim() !== '')
      .map(([status, labelId]) => [status, labelId as string])
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function syncGpaStatusLabels(options: GpaStatusLabelSyncOptions): Promise<GpaStatusLabelSyncResult> {
  const dryRun = options.dryRun === true
  const result: GpaStatusLabelSyncResult = {
    dryRun,
    applications: 0,
    applicationsSkipped: 0,
    applicationsFailed: 0,
    submissions: 0,
    labelsAdded: 0,
    labelsRemoved: 0,
    unchanged: 0,
    skipped: 0,
    failures: []
  }

  const applicationQuery: Record<string, unknown> = { cycleId: options.cycleId }
  if (options.applicationId) applicationQuery._id = options.applicationId
  const applications = await ApplicationModel.find(applicationQuery).select('name scoring').lean()
  result.applications = applications.length

  const submissions = await SubmissionModel.find({
    cycleId: options.cycleId,
    ...(options.applicationId ? { applicationId: options.applicationId } : { applicationId: { $in: applications.map(application => String(application._id)) } })
  }).select('submissionId applicationId gpaStatus labelIds').lean()

  result.submissions = submissions.length
  const submissionsByApplication = new Map<string, typeof submissions>()
  for (const submission of submissions) {
    const applicationId = String(submission.applicationId || '')
    const group = submissionsByApplication.get(applicationId) || []
    group.push(submission)
    submissionsByApplication.set(applicationId, group)
  }

  let processed = 0
  await options.setProgress?.({ phase: 'syncing_gpa_status_labels', total: submissions.length, processed: 0, percent: 0, message: 'Synchronizing GPA status labels' })

  for (const application of applications) {
    const applicationId = String(application._id)
    const mapping = configuredLabels(application.scoring)
    const mappedLabelIds = Object.values(mapping)
    const managedLabels = [...new Set(mappedLabelIds)]

    if (!managedLabels.length) {
      result.applicationsSkipped += 1
      continue
    }

    const labelCounts = new Map<string, number>()
    for (const labelId of mappedLabelIds) labelCounts.set(labelId, (labelCounts.get(labelId) || 0) + 1)
    const duplicateLabels = managedLabels.filter(labelId => (labelCounts.get(labelId) || 0) > 1)
    if (duplicateLabels.length) {
      result.applicationsFailed += 1
      result.failures.push({
        applicationId,
        applicationName: application.name,
        operation: 'configuration',
        error: `The same Submittable label is assigned to multiple GPA statuses: ${duplicateLabels.join(', ')}`
      })
      continue
    }

    interface PlannedChange {
      submission: Submission
      nextLabelIds: string[]
      addLabelIds: string[]
      removeLabelIds: string[]
      failed: boolean
    }

    const planned: PlannedChange[] = []
    for (const submission of submissionsByApplication.get(applicationId) || []) {
      const currentLabelIds = submission.labelIds || []
      const status = canonicalGpaStatus(submission.gpaStatus)
      const desiredLabelId = mapping[status]
      const managedCurrent = currentLabelIds.filter(labelId => managedLabels.includes(labelId))
      const nextLabelIds = [
        ...currentLabelIds.filter(labelId => !managedLabels.includes(labelId)),
        ...(desiredLabelId ? [desiredLabelId] : [])
      ]
      const addLabelIds = desiredLabelId && !currentLabelIds.includes(desiredLabelId) ? [desiredLabelId] : []
      const removeLabelIds = managedCurrent.filter(labelId => labelId !== desiredLabelId)

      if (!addLabelIds.length && !removeLabelIds.length) {
        if (desiredLabelId || managedCurrent.length) result.unchanged += 1
        else result.skipped += 1
      } else {
        planned.push({ submission, nextLabelIds, addLabelIds, removeLabelIds, failed: false })
      }
    }

    const addsByLabel = new Map<string, PlannedChange[]>()
    for (const change of planned) {
      for (const labelId of change.addLabelIds) {
        const group = addsByLabel.get(labelId) || []
        group.push(change)
        addsByLabel.set(labelId, group)
      }
    }

    if (dryRun) {
      result.labelsAdded += planned.reduce((count, change) => count + change.addLabelIds.length, 0)
      result.labelsRemoved += planned.reduce((count, change) => count + change.removeLabelIds.length, 0)
      processed += planned.length
      await options.setProgress?.({ processed, message: `Previewed GPA labels for ${application.name}` })
      continue
    }

    for (const [labelId, changes] of addsByLabel) {
      try {
        await addSubmissionLabelBulk(changes.map(change => change.submission.submissionId), labelId, options.submittable)
        result.labelsAdded += changes.length
      } catch (error) {
        for (const change of changes) change.failed = true
        for (const change of changes) {
          result.failures.push({ applicationId, applicationName: application.name, submissionId: change.submission.submissionId, operation: 'add', error: errorMessage(error) })
        }
      }
      processed += changes.length
      await options.setProgress?.({ processed })
    }

    for (const change of planned.filter(item => !item.failed)) {
      for (const labelId of change.removeLabelIds) {
        try {
          await removeSubmissionLabel(change.submission.submissionId, labelId, options.submittable)
          result.labelsRemoved += 1
        } catch (error) {
          change.failed = true
          result.failures.push({ applicationId, applicationName: application.name, submissionId: change.submission.submissionId, operation: 'remove', error: errorMessage(error) })
        }
      }
    }

    const updates = planned
      .filter(change => !change.failed)
      .map(change => ({
        updateOne: {
          filter: { cycleId: options.cycleId, applicationId, submissionId: change.submission.submissionId },
          update: { $set: { labelIds: change.nextLabelIds } }
        }
      }))
    if (updates.length) await SubmissionModel.bulkWrite(updates)
  }

  await options.setProgress?.({ phase: 'completed', processed: result.submissions, percent: 100, message: `GPA status label sync complete: ${result.labelsAdded} added, ${result.labelsRemoved} removed` })
  return result
}
