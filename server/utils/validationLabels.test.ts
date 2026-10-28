import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SubmissionModel } from '../models/Submission'
import { ValidationIssueModel } from '../models/ValidationIssue'
import { addSubmissionLabelBulk, fetchLabels, fetchSubmission, fetchSubmissionsForProject, removeSubmissionLabel } from './submittable'
import { reconcileValidationLabelsForCycle, reconcileValidationLabelsForSubmission } from './validationLabels'

vi.mock('./submittable', () => ({
  addSubmissionLabelBulk: vi.fn(),
  fetchLabels: vi.fn(),
  fetchSubmission: vi.fn(),
  fetchSubmissionsForProject: vi.fn(),
  removeSubmissionLabel: vi.fn()
}))

const config = { apiKey: 'test' }
const labels = ['Check Address', 'Check Age', 'Check for Duplicate', 'Check Student Number', 'Check Name', 'Check Documents']
  .map((name, index) => ({ name, labelId: `label-${index}` }))
const labelId = (name: string) => labels.find(label => label.name === name)!.labelId
let submissions: { cycleId: string, submissionId: string, projectId: string, labelIds: string[] }[]
let issues: { submissionId: string, type: string, status: string, severity: string }[]

beforeEach(() => {
  vi.resetAllMocks()
  submissions = [
    { cycleId: 'cycle-1', submissionId: 'sub-1', projectId: 'project-1', labelIds: [] },
    { cycleId: 'cycle-1', submissionId: 'sub-2', projectId: 'project-1', labelIds: [] }
  ]
  issues = []
  vi.mocked(fetchLabels).mockResolvedValue(labels)
  vi.mocked(fetchSubmissionsForProject).mockImplementation(async () => submissions.map(s => ({ submissionId: s.submissionId, labels: [...s.labelIds] })))
  vi.mocked(fetchSubmission).mockImplementation(async id => ({ submissionId: id, labels: [...submissions.find(s => s.submissionId === id)!.labelIds] }))
  vi.mocked(addSubmissionLabelBulk).mockImplementation(async (ids, id) => {
    for (const sub of submissions.filter(s => ids.includes(s.submissionId))) sub.labelIds.push(id)
  })
  vi.mocked(removeSubmissionLabel).mockImplementation(async (id, label) => {
    const sub = submissions.find(s => s.submissionId === id)!
    sub.labelIds = sub.labelIds.filter(item => item !== label)
  })
  vi.spyOn(SubmissionModel, 'find').mockImplementation(() => ({ select: () => ({ lean: async () => submissions }) }) as never)
  vi.spyOn(SubmissionModel, 'findOne').mockImplementation(() => ({ select: () => ({ lean: async () => submissions[0] }) }) as never)
  vi.spyOn(SubmissionModel, 'bulkWrite').mockResolvedValue({} as never)
  vi.spyOn(SubmissionModel, 'updateOne').mockResolvedValue({} as never)
  vi.spyOn(ValidationIssueModel, 'find').mockImplementation(() => ({ select: () => ({ lean: async () => issues.filter(i => i.status === 'open') }) }) as never)
})

describe('validation label reconciliation', () => {
  it('bulk-groups warnings and errors by label while preserving unrelated labels', async () => {
    submissions[0]!.labelIds = ['other-label']
    issues = [
      { submissionId: 'sub-1', type: 'dob_out_of_range', status: 'open', severity: 'warning' },
      { submissionId: 'sub-1', type: 'student_number_invalid', status: 'open', severity: 'error' },
      { submissionId: 'sub-1', type: 'student_number_length', status: 'open', severity: 'warning' },
      { submissionId: 'sub-1', type: 'parent_student_name_swap', status: 'open', severity: 'warning' },
      { submissionId: 'sub-1', type: 'duplicate_applicant', status: 'open', severity: 'error' },
      { submissionId: 'sub-1', type: 'missing_required_documents', status: 'open', severity: 'warning' },
      { submissionId: 'sub-1', type: 'geocoding_failed', status: 'open', severity: 'error' },
      { submissionId: 'sub-2', type: 'student_number_length', status: 'open', severity: 'warning' }
    ]

    const result = await reconcileValidationLabelsForCycle('cycle-1', config)
    expect(result).toMatchObject({ added: 7, removed: 0 })
    expect(addSubmissionLabelBulk).toHaveBeenCalledWith(['sub-1', 'sub-2'], labelId('Check Student Number'), config)
    expect(addSubmissionLabelBulk).toHaveBeenCalledTimes(6)
    expect(submissions[0]!.labelIds).toContain('other-label')
    expect(removeSubmissionLabel).not.toHaveBeenCalled()
  })

  it('removes stale labels for withdrawn submissions and leaves remaining issue labels', async () => {
    submissions[0]!.labelIds = [labelId('Check Age'), labelId('Check Student Number'), 'other-label']
    submissions[1]!.labelIds = [labelId('Check Name')]
    issues = [{ submissionId: 'sub-1', type: 'student_number_length', status: 'open', severity: 'warning' }]
    const result = await reconcileValidationLabelsForCycle('cycle-1', config)
    expect(result).toMatchObject({ added: 0, removed: 2 })
    expect(submissions[0]!.labelIds).toEqual([labelId('Check Student Number'), 'other-label'])
    expect(submissions[1]!.labelIds).toEqual([])
    expect(addSubmissionLabelBulk).not.toHaveBeenCalled()
  })

  it('removes a label on override only after the last issue requiring it is resolved', async () => {
    submissions[0]!.labelIds = [labelId('Check Student Number')]
    issues = [{ submissionId: 'sub-1', type: 'student_number_length', status: 'open', severity: 'warning' }]
    await reconcileValidationLabelsForSubmission('cycle-1', 'sub-1', config)
    expect(removeSubmissionLabel).not.toHaveBeenCalled()
    issues = []
    await reconcileValidationLabelsForSubmission('cycle-1', 'sub-1', config)
    expect(removeSubmissionLabel).toHaveBeenCalledWith('sub-1', labelId('Check Student Number'), config)
  })

  it('fails before changing assignments if a configured label is missing', async () => {
    vi.mocked(fetchLabels).mockResolvedValue(labels.slice(1))
    await expect(reconcileValidationLabelsForCycle('cycle-1', config)).rejects.toThrow('Check Address')
    expect(addSubmissionLabelBulk).not.toHaveBeenCalled()
  })

  it('does not update local labels when a remote change fails', async () => {
    issues = [{ submissionId: 'sub-1', type: 'dob_out_of_range', status: 'open', severity: 'error' }]
    vi.mocked(addSubmissionLabelBulk).mockRejectedValueOnce(new Error('remote failed'))
    await expect(reconcileValidationLabelsForCycle('cycle-1', config)).rejects.toThrow('remote failed')
    expect(SubmissionModel.bulkWrite).not.toHaveBeenCalled()
  })

  it('does not update local labels when removal fails, then recovers on rerun', async () => {
    submissions[0]!.labelIds = [labelId('Check Age')]
    vi.mocked(removeSubmissionLabel).mockRejectedValueOnce(new Error('remote failed'))
    await expect(reconcileValidationLabelsForCycle('cycle-1', config)).rejects.toThrow('remote failed')
    expect(SubmissionModel.bulkWrite).not.toHaveBeenCalled()
    const result = await reconcileValidationLabelsForCycle('cycle-1', config)
    expect(result).toMatchObject({ added: 0, removed: 1 })
    expect(submissions[0]!.labelIds).toEqual([])
    expect(await reconcileValidationLabelsForCycle('cycle-1', config)).toMatchObject({ added: 0, removed: 0 })
  })

  it('rejects ambiguous validation label definitions before modifying submissions', async () => {
    vi.mocked(fetchLabels).mockResolvedValue([...labels, labels[0]!])
    await expect(reconcileValidationLabelsForCycle('cycle-1', config)).rejects.toThrow('Check Address')
    expect(addSubmissionLabelBulk).not.toHaveBeenCalled()
  })
})
