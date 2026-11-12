import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  submissionUpdateMany: vi.fn(),
  stageFind: vi.fn(),
  stageUpdateOne: vi.fn(),
  applicationFind: vi.fn(),
  applicationUpdateOne: vi.fn()
}))

vi.mock('../models/Submission', () => ({ SubmissionModel: { updateMany: mocks.submissionUpdateMany } }))
vi.mock('../models/ReviewStage', () => ({ ReviewStageModel: { find: mocks.stageFind, updateOne: mocks.stageUpdateOne } }))
vi.mock('../models/Application', () => ({ ApplicationModel: { find: mocks.applicationFind, updateOne: mocks.applicationUpdateOne } }))

const { migrateOptInPartialStatus } = await import('./migrateOptInPartialStatus')

describe('migrateOptInPartialStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.submissionUpdateMany.mockResolvedValue({ modifiedCount: 2 })
    mocks.stageFind.mockReturnValue({ select: () => ({ lean: async () => [{ _id: 'stage-1' }] }) })
    mocks.applicationFind.mockReturnValue({ select: () => ({ lean: async () => [{ _id: 'app-1' }] }) })
  })

  it('updates stored submission statuses', async () => {
    await expect(migrateOptInPartialStatus()).resolves.toEqual({ submissions: 2, stages: 0, dashboards: 0 })
    expect(mocks.submissionUpdateMany).toHaveBeenCalledWith(
      { gpaStatus: 'OOD Partial' },
      { $set: { gpaStatus: 'Opt-In Partial' } }
    )
  })

  it('recursively rewrites routing and dashboard values without changing other strings', async () => {
    const routing = { requiredWhen: { all: [{ kind: 'gpaStatus', op: 'in', value: ['Partial', 'OOD Partial'] }] }, note: 'Not OOD Partially' }
    const routingDraft = { requiredWhen: { all: [{ kind: 'gpaStatus', op: 'eq', value: 'OOD Partial' }] } }
    const dashboard = { highlights: [{ metric: { type: 'gpaStatus', status: 'OOD Partial' }, label: 'GPA' }] }
    mocks.stageFind.mockReturnValue({ select: () => ({ lean: async () => [{ _id: 'stage-1', routing, routingDraft }] }) })
    mocks.applicationFind.mockReturnValue({ select: () => ({ lean: async () => [{ _id: 'app-1', dashboard }] }) })

    await expect(migrateOptInPartialStatus()).resolves.toEqual({ submissions: 2, stages: 1, dashboards: 1 })
    expect(mocks.stageUpdateOne).toHaveBeenCalledWith({ _id: 'stage-1' }, { $set: {
      routing: { requiredWhen: { all: [{ kind: 'gpaStatus', op: 'in', value: ['Partial', 'Opt-In Partial'] }] }, note: 'Not OOD Partially' },
      routingDraft: { requiredWhen: { all: [{ kind: 'gpaStatus', op: 'eq', value: 'Opt-In Partial' }] } }
    } })
    expect(mocks.applicationUpdateOne).toHaveBeenCalledWith({ _id: 'app-1' }, { $set: {
      dashboard: { highlights: [{ metric: { type: 'gpaStatus', status: 'Opt-In Partial' }, label: 'GPA' }] }
    } })
  })
})
