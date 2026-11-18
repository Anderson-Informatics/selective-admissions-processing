import type { JobProgress } from '../models/Job'
import { GpaRecordModel } from '../models/GpaRecord'
import { SubmissionModel, type Submission } from '../models/Submission'
import { resolveGpaBonusLabelId } from './gpaScoring'
import { isWithdrawnSubmission } from './submissionStatus'
import { addSubmissionLabelBulk, removeSubmissionLabel, type SubmittableClientConfig } from './submittable'

// ---------------------------------------------------------------------------
// GPA Bonus Eligible label sync
//
// Keeps the Submittable "GPA Bonus Eligible" label aligned with the computed
// GpaRecord.gpaBonusEligible flag (stamped by refresh_review_completion and
// score_compilation). Diff-only: adds the label where it is missing on
// eligible submissions and removes it where it lingers on ineligible or
// withdrawn submissions. Eligibility itself no longer depends on the label.
// ---------------------------------------------------------------------------

export interface GpaBonusLabelSyncOptions {
  cycleId: string
  applicationId?: string
  dryRun?: boolean
  setProgress?: (progress: Partial<JobProgress>) => Promise<void>
  submittable?: SubmittableClientConfig
}

export interface GpaBonusLabelSyncResult {
  dryRun: boolean
  labelResolved: boolean
  submissions: number
  eligible: number
  labelsAdded: number
  labelsRemoved: number
  unchanged: number
  failures: Array<{ submissionId: string, operation: 'add' | 'remove', error: string }>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function syncGpaBonusLabel(options: GpaBonusLabelSyncOptions): Promise<GpaBonusLabelSyncResult> {
  const dryRun = options.dryRun === true
  const result: GpaBonusLabelSyncResult = {
    dryRun,
    labelResolved: false,
    submissions: 0,
    eligible: 0,
    labelsAdded: 0,
    labelsRemoved: 0,
    unchanged: 0,
    failures: []
  }

  const labelId = await resolveGpaBonusLabelId()
  if (!labelId) {
    await options.setProgress?.({ message: 'No "GPA Bonus Eligible" label found; skipping bonus label sync' })
    return result
  }
  result.labelResolved = true

  const submissionFilter: Record<string, unknown> = { cycleId: options.cycleId }
  if (options.applicationId) submissionFilter.applicationId = options.applicationId
  const submissions = await SubmissionModel.find(submissionFilter).select('submissionId status labelIds').lean()
  result.submissions = submissions.length

  const gpaRecords = await GpaRecordModel.find({
    cycleId: options.cycleId,
    submissionId: { $in: submissions.map(submission => submission.submissionId) }
  }).select('submissionId gpaBonusEligible').lean()
  const eligibleBySubmissionId = new Map(
    gpaRecords.filter(record => record.gpaBonusEligible === true).map(record => [record.submissionId, true])
  )

  interface PlannedChange {
    submission: Submission
    add: boolean
    nextLabelIds: string[]
  }

  const planned: PlannedChange[] = []
  for (const submission of submissions) {
    const eligible = eligibleBySubmissionId.get(submission.submissionId) === true && !isWithdrawnSubmission(submission)
    if (eligible) result.eligible += 1
    const currentLabelIds = submission.labelIds || []
    const hasLabel = currentLabelIds.includes(labelId)
    if (eligible === hasLabel) {
      result.unchanged += 1
      continue
    }
    planned.push({
      submission,
      add: eligible,
      nextLabelIds: eligible
        ? [...currentLabelIds, labelId]
        : currentLabelIds.filter(id => id !== labelId)
    })
  }

  await options.setProgress?.({
    phase: 'syncing_gpa_bonus_label',
    message: `${dryRun ? 'Previewing' : 'Synchronizing'} GPA bonus label: ${planned.filter(change => change.add).length} additions, ${planned.filter(change => !change.add).length} removals`
  })

  if (dryRun) {
    result.labelsAdded = planned.filter(change => change.add).length
    result.labelsRemoved = planned.length - result.labelsAdded
    return result
  }

  const adds = planned.filter(change => change.add)
  if (adds.length) {
    try {
      const unapplied = await addSubmissionLabelBulk(adds.map(change => change.submission.submissionId), labelId, options.submittable) || []
      result.labelsAdded = adds.length - unapplied.length
      for (const submissionId of unapplied) {
        result.failures.push({ submissionId, operation: 'add', error: 'Submittable did not confirm the label' })
      }
    } catch (error) {
      for (const change of adds) {
        result.failures.push({ submissionId: change.submission.submissionId, operation: 'add', error: errorMessage(error) })
      }
    }
  }

  for (const change of planned.filter(item => !item.add)) {
    try {
      await removeSubmissionLabel(change.submission.submissionId, labelId, options.submittable)
      result.labelsRemoved += 1
    } catch (error) {
      result.failures.push({ submissionId: change.submission.submissionId, operation: 'remove', error: errorMessage(error) })
    }
  }

  const failedIds = new Set(result.failures.map(failure => failure.submissionId))
  const updates = planned
    .filter(change => !failedIds.has(change.submission.submissionId))
    .map(change => ({
      updateOne: {
        filter: { cycleId: options.cycleId, submissionId: change.submission.submissionId },
        update: { $set: { labelIds: change.nextLabelIds } }
      }
    }))
  if (updates.length) await SubmissionModel.bulkWrite(updates)

  await options.setProgress?.({ message: `GPA bonus label sync complete: ${result.labelsAdded} added, ${result.labelsRemoved} removed` })
  return result
}
