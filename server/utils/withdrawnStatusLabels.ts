import type { AnyBulkWriteOperation } from 'mongoose'
import { ApplicationModel } from '../models/Application'
import type { JobProgress } from '../models/Job'
import { ReviewStageModel } from '../models/ReviewStage'
import { SubmissionModel, type Submission } from '../models/Submission'
import { fetchSubmissionsForProject, removeSubmissionLabel, type SubmittableClientConfig } from './submittable'

export interface WithdrawnStatusLabelCleanupOptions {
  cycleId: string
  applicationId?: string
  dryRun?: boolean
  setProgress?: (progress: Partial<JobProgress>) => Promise<void>
  submittable?: SubmittableClientConfig
}

export interface WithdrawnStatusLabelCleanupResult {
  dryRun: boolean
  submissions: number
  managedLabels: number
  labelsRemoved: number
  unchanged: number
  failures: { submissionId: string, labelId: string, error: string }[]
}

function configuredGpaLabels(scoring: unknown): string[] {
  const labels = scoring && typeof scoring === 'object' && !Array.isArray(scoring)
    ? (scoring as Record<string, unknown>).gpaStatusLabels
    : undefined
  if (!labels || typeof labels !== 'object' || Array.isArray(labels)) return []
  return Object.values(labels).filter((labelId): labelId is string => typeof labelId === 'string' && Boolean(labelId))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function clearWithdrawnStatusLabels(options: WithdrawnStatusLabelCleanupOptions): Promise<WithdrawnStatusLabelCleanupResult> {
  const dryRun = options.dryRun === true
  const result: WithdrawnStatusLabelCleanupResult = {
    dryRun,
    submissions: 0,
    managedLabels: 0,
    labelsRemoved: 0,
    unchanged: 0,
    failures: []
  }

  const applicationQuery: Record<string, unknown> = { cycleId: options.cycleId }
  if (options.applicationId) applicationQuery._id = options.applicationId
  const applications = await ApplicationModel.find(applicationQuery).select('projectId scoring').lean()
  const applicationIds = applications.map(application => String(application._id))
  if (!applicationIds.length) return result

  const [stages, submissions] = await Promise.all([
    ReviewStageModel.find({ cycleId: options.cycleId, applicationId: { $in: applicationIds } })
      .select('applicationId routing.statusLabels')
      .lean(),
    SubmissionModel.find({
      cycleId: options.cycleId,
      applicationId: { $in: applicationIds },
      status: /^withdrawn$/i
    }).select('submissionId applicationId projectId labelIds').lean()
  ])
  result.submissions = submissions.length
  if (!submissions.length) return result

  const managedByApplication = new Map<string, Set<string>>()
  for (const applicationId of applicationIds) managedByApplication.set(applicationId, new Set())
  for (const stage of stages) {
    const labels = managedByApplication.get(String(stage.applicationId))
    for (const labelId of Object.values(stage.routing?.statusLabels || {})) {
      if (labelId) labels?.add(labelId)
    }
  }
  for (const application of applications) {
    const labels = managedByApplication.get(String(application._id))
    for (const labelId of configuredGpaLabels(application.scoring)) labels?.add(labelId)
  }
  result.managedLabels = [...new Set([...managedByApplication.values()].flatMap(labels => [...labels]))].length

  const remoteByProject = new Map<string, Map<string, string[]>>()
  const failedProjects = new Set<string>()
  const projectIds = [...new Set(submissions.map(submission => submission.projectId).filter(Boolean))]
  await options.setProgress?.({ phase: 'loading_withdrawn_labels', processed: 0, total: projectIds.length, message: 'Loading withdrawn submission labels' })
  for (const [index, projectId] of projectIds.entries()) {
    const remote = new Map<string, string[]>()
    try {
      const remoteSubmissions = await fetchSubmissionsForProject(projectId, options.submittable)
      for (const submission of remoteSubmissions) remote.set(submission.submissionId, submission.labels || [])
    } catch (error) {
      failedProjects.add(projectId)
      for (const submission of submissions.filter(item => item.projectId === projectId)) {
        result.failures.push({ submissionId: submission.submissionId, labelId: '', error: errorMessage(error) })
      }
    }
    remoteByProject.set(projectId, remote)
    await options.setProgress?.({ phase: 'loading_withdrawn_labels', processed: index + 1, total: projectIds.length })
  }

  const updates: AnyBulkWriteOperation<Submission>[] = []
  let processed = 0
  await options.setProgress?.({ phase: 'clearing_withdrawn_labels', processed: 0, total: submissions.length, message: 'Clearing withdrawn status labels' })
  for (const submission of submissions) {
    const managed = managedByApplication.get(String(submission.applicationId)) || new Set<string>()
    const remoteLabels = failedProjects.has(submission.projectId)
      ? undefined
      : remoteByProject.get(submission.projectId)?.get(submission.submissionId)
    if (failedProjects.has(submission.projectId)) {
      processed += 1
      continue
    }
    const current = remoteLabels ?? submission.labelIds ?? []
    const currentManaged = current.filter(labelId => managed.has(labelId))
    if (!currentManaged.length) {
      result.unchanged += 1
    } else if (dryRun) {
      result.labelsRemoved += currentManaged.length
    } else {
      const next = new Set(current)
      for (const labelId of currentManaged) {
        try {
          await removeSubmissionLabel(submission.submissionId, labelId, options.submittable)
          next.delete(labelId)
          result.labelsRemoved += 1
        } catch (error) {
          result.failures.push({ submissionId: submission.submissionId, labelId, error: errorMessage(error) })
        }
      }
      updates.push({
        updateOne: {
          filter: { cycleId: options.cycleId, submissionId: submission.submissionId },
          update: { $set: { labelIds: [...next] } }
        }
      })
    }
    processed += 1
    await options.setProgress?.({ phase: 'clearing_withdrawn_labels', processed, total: submissions.length })
  }

  if (updates.length) await SubmissionModel.bulkWrite(updates)
  return result
}
