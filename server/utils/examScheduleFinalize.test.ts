import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runExamScheduleFinalize } from './examScheduleFinalize'

const mocks = vi.hoisted(() => ({ load: vi.fn(), compute: vi.fn(), template: vi.fn(), labels: vi.fn(), message: vi.fn(), save: vi.fn() }))
vi.mock('./examSchedulingRun', () => ({ loadExamScheduleContext: mocks.load, computeSessionAssignment: mocks.compute, resolveGroupLabelIds: vi.fn() }))
vi.mock('../models/MessageTemplate', () => ({ MessageTemplateModel: { findById: mocks.template } }))
vi.mock('../models/Cycle', () => ({ CycleModel: { updateOne: mocks.save } }))
vi.mock('./submittable', () => ({ addSubmissionLabelBulk: mocks.labels, sendSubmissionMessage: mocks.message }))
vi.mock('./routingActions', () => ({ renderMergeFields: vi.fn() }))
vi.mock('./routingRun', () => ({ buildRoutingContext: vi.fn(), loadListOptionLabels: vi.fn(), loadResponseLibraries: vi.fn() }))
vi.mock('./disclosureAudit', () => ({ recordDisclosure: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.load.mockResolvedValue({ cycle: { _id: 'cycle' }, config: {} })
  mocks.compute.mockResolvedValue({ unassignedIds: ['unassigned-blocker'] })
})

describe('exam finalize worker preflight', () => {
  it('checks the session plus queued members before any external side effects', async () => {
    await expect(runExamScheduleFinalize({ cycleId: 'cycle', payload: { sessionLabelId: 'session', templateId: 'template', assignments: { queued: 'IEP504' } } })).rejects.toThrow('Required IEP/504 Completion review forms are missing')
    expect(mocks.compute).toHaveBeenCalledWith(expect.anything(), 'session', ['queued'])
    expect(mocks.template).not.toHaveBeenCalled()
    expect(mocks.labels).not.toHaveBeenCalled()
    expect(mocks.message).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
  })
})
