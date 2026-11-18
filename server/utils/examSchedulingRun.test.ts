import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computeSessionAssignment, loadExamScheduleContext } from './examSchedulingRun'
import { normalizeExamSchedulingConfig } from './examScheduling'

const mocks = vi.hoisted(() => ({ cycle: vi.fn(), submissions: vi.fn(), labels: vi.fn(), reviews: vi.fn(), stages: vi.fn() }))
vi.mock('../models/Cycle', () => ({ CycleModel: { findById: mocks.cycle } }))
vi.mock('../models/Submission', () => ({ SubmissionModel: { find: mocks.submissions } }))
vi.mock('../models/Metadata', () => ({ MetadataModel: { find: mocks.labels } }))
vi.mock('../models/Review', () => ({ ReviewModel: { find: mocks.reviews } }))
vi.mock('../models/ReviewStage', () => ({ ReviewStageModel: { find: mocks.stages } }))
const query = (value: unknown) => ({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(value) }) })
const student = { submissionId: 'student', applicationId: 'app', submissionIdInt: 123, mappedFields: { FullName: 'Student Name' }, labelIds: ['session', 'iep'], reviewCompletion: [{ stageId: 'completion', name: 'IEP/504 Completion', required: true, complete: true }] }
const config = normalizeExamSchedulingConfig({ iep504LabelIds: ['iep'] })
const context = { cycle: { _id: 'cycle' }, config, labels: [{ externalId: 'iep', name: 'IEP' }], submissions: [student] }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.cycle.mockReturnValue(query({ _id: 'cycle', examScheduling: config }))
  mocks.submissions.mockReturnValue(query([student]))
  mocks.labels.mockReturnValue(query(context.labels))
  mocks.reviews.mockReturnValue(query([]))
  mocks.stages.mockReturnValue(query([{ applicationId: 'app', stageId: 'completion', name: 'IEP/ 504 Completion' }]))
})

describe('exam schedule context', () => {
  it('loads display fields and batches reviews and application stages', async () => {
    const loaded = await loadExamScheduleContext('cycle')
    const result = await computeSessionAssignment(loaded!, 'session')
    expect(result.unassignedIds).toEqual(['student'])
    expect(result.members.student).toMatchObject({ fullName: 'Student Name', submissionIdInt: 123, specialLabels: ['IEP'] })
    expect(mocks.reviews).toHaveBeenCalledExactlyOnceWith({ cycleId: 'cycle', submissionId: { $in: ['student'] } })
    expect(mocks.stages).toHaveBeenCalledExactlyOnceWith({ cycleId: 'cycle' })
  })

  it('includes queued assignment members even if their session label changed', async () => {
    const result = await computeSessionAssignment({ ...context, submissions: [{ ...student, labelIds: ['iep'] }] }, 'session', ['student'])
    expect(result.unassignedIds).toEqual(['student'])
  })

  it('accepts completed forms using application-stage metadata despite stale review names', async () => {
    mocks.reviews.mockReturnValue(query([{ submissionId: 'student', applicationId: 'app', stageId: 'completion', stageName: 'Old name', status: 'completed', mappedData: { CompleteIEP504: 'No' } }]))
    const result = await computeSessionAssignment(context, 'session')
    expect(result.unassignedIds).toEqual([])
    expect(result.assignments.student).toBe('RED')
  })
})
