import type { AnyBulkWriteOperation } from 'mongoose'
import { SubmissionModel, type Submission } from '../models/Submission'
import { ValidationIssueModel } from '../models/ValidationIssue'
import { addSubmissionLabelBulk, fetchLabels, fetchSubmission, fetchSubmissionsForProject, removeSubmissionLabel, type SubmittableClientConfig, type SubmittableSubmissionListItem } from './submittable'
import { mapWithConcurrency } from './concurrency'

const labelByIssueType: Record<string, string> = {
  dob_out_of_range: 'Check Age',
  student_number_invalid: 'Check Student Number',
  student_number_length: 'Check Student Number',
  parent_student_name_swap: 'Check Name',
  duplicate_applicant: 'Check for Duplicate',
  missing_required_documents: 'Check Documents',
  geocoding_failed: 'Check Address'
}

type LabelSubmission = Pick<Submission, 'cycleId' | 'submissionId' | 'projectId'>
type OpenIssue = { submissionId: string, type: string }

async function resolveLabelIds(clientConfig?: SubmittableClientConfig) {
  const labels = await fetchLabels(clientConfig)
  const ids = new Map<string, string>()
  for (const name of new Set(Object.values(labelByIssueType))) {
    const matches = labels.filter(label => label.name === name)
    if (matches.length !== 1) throw new Error(`Expected exactly one Submittable label named "${name}"; found ${matches.length}`)
    ids.set(name, matches[0]!.labelId)
  }
  return ids
}

async function reconcile(
  submissions: LabelSubmission[],
  remoteById: Map<string, SubmittableSubmissionListItem>,
  issues: OpenIssue[],
  clientConfig?: SubmittableClientConfig
) {
  if (!submissions.length) return { added: 0, removed: 0 }
  const ids = await resolveLabelIds(clientConfig)
  const managedIds = new Set(ids.values())
  const desiredById = new Map<string, Set<string>>()
  for (const issue of issues) {
    const labelName = labelByIssueType[issue.type]
    if (!labelName) continue
    const desired = desiredById.get(issue.submissionId) || new Set<string>()
    desired.add(ids.get(labelName)!)
    desiredById.set(issue.submissionId, desired)
  }

  const additions = new Map<string, string[]>()
  const removals: { submissionId: string, labelId: string }[] = []
  const finalLabels = new Map<string, string[]>()
  for (const submission of submissions) {
    const remote = remoteById.get(submission.submissionId)
    if (!remote) throw new Error(`Submission ${submission.submissionId} was not found in Submittable`)
    const current = new Set(remote.labels || [])
    const desired = desiredById.get(submission.submissionId) || new Set<string>()
    for (const labelId of desired) {
      if (!current.has(labelId)) {
        additions.set(labelId, [...(additions.get(labelId) || []), submission.submissionId])
      }
    }
    for (const labelId of current) {
      if (managedIds.has(labelId) && !desired.has(labelId)) {
        removals.push({ submissionId: submission.submissionId, labelId })
      }
    }
    finalLabels.set(submission.submissionId, [
      ...[...current].filter(id => !managedIds.has(id) || desired.has(id)),
      ...[...desired].filter(id => !current.has(id))
    ])
  }

  for (const [labelId, submissionIds] of additions) {
    await addSubmissionLabelBulk(submissionIds, labelId, clientConfig)
  }
  const removalResults = await mapWithConcurrency(removals, 3, async (item) => {
    try {
      await removeSubmissionLabel(item.submissionId, item.labelId, clientConfig)
      return null
    } catch (error) {
      return error
    }
  })
  const failure = removalResults.find(result => result !== null)
  if (failure) throw failure

  for (let index = 0; index < submissions.length; index += 500) {
    const operations: AnyBulkWriteOperation<Submission>[] = submissions.slice(index, index + 500).map(submission => ({
      updateOne: {
        filter: { cycleId: submission.cycleId, submissionId: submission.submissionId },
        update: { $set: { labelIds: finalLabels.get(submission.submissionId)! } }
      }
    }))
    await SubmissionModel.bulkWrite(operations)
  }
  return { added: [...additions.values()].reduce((sum, list) => sum + list.length, 0), removed: removals.length }
}

export async function reconcileValidationLabelsForCycle(cycleId: string, clientConfig?: SubmittableClientConfig) {
  const submissions = await SubmissionModel.find({ cycleId }).select('cycleId submissionId projectId').lean()
  if (!submissions.length) return { added: 0, removed: 0 }
  const issues = await ValidationIssueModel.find({ cycleId, status: 'open', type: { $in: Object.keys(labelByIssueType) } })
    .select('submissionId type').lean()
  const remoteById = new Map<string, SubmittableSubmissionListItem>()
  const projectIds = [...new Set(submissions.map(submission => submission.projectId))]
  await mapWithConcurrency(projectIds, 3, async (projectId) => {
    for (const remote of await fetchSubmissionsForProject(projectId, clientConfig)) {
      remoteById.set(remote.submissionId, remote)
    }
  })
  return reconcile(submissions, remoteById, issues, clientConfig)
}

export async function reconcileValidationLabelsForSubmission(cycleId: string, submissionId: string, clientConfig?: SubmittableClientConfig) {
  const submission = await SubmissionModel.findOne({ cycleId, submissionId }).select('cycleId submissionId projectId').lean()
  if (!submission) throw new Error(`Submission ${submissionId} was not found in cycle ${cycleId}`)
  const issues = await ValidationIssueModel.find({ cycleId, submissionId, status: 'open', type: { $in: Object.keys(labelByIssueType) } })
    .select('submissionId type').lean()
  const remote = await fetchSubmission(submissionId, clientConfig)
  return reconcile([submission], new Map([[submissionId, remote]]), issues, clientConfig)
}
