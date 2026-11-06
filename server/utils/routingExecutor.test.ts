import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SubmissionModel } from '../models/Submission'
import { evaluateCycleSubmissions } from './routingRun'
import { executeRoutingRun } from './routingExecutor'
import * as routingActions from './routingActions'
import * as submittable from './submittable'

vi.mock('./routingRun', () => ({ evaluateCycleSubmissions: vi.fn(), loadListOptionLabels: vi.fn() }))

beforeEach(() => {
  vi.restoreAllMocks()
  vi.mocked(evaluateCycleSubmissions).mockResolvedValue({ submissions: [], applicationNames: new Map(), stageNameById: new Map() })
})

describe('routing refresh coverage', () => {
  it('refreshes the same requested limit instead of silently capping it at 2000', async () => {
    const limit = vi.fn(() => ({ lean: async () => [] }))
    vi.spyOn(SubmissionModel, 'find').mockReturnValue({ sort: () => ({ select: () => ({ limit }) }) } as never)
    await executeRoutingRun({ cycleId: 'cycle', limit: 5000, actor: 'actor', dryRun: true })
    expect(limit).toHaveBeenCalledWith(5000)
  })

  it('saves proposed move details in a dry run without external writes', async () => {
    vi.spyOn(SubmissionModel, 'find').mockReturnValue({ sort: () => ({ select: () => ({ limit: () => ({ lean: async () => [] }) }) }) } as never)
    vi.mocked(evaluateCycleSubmissions).mockResolvedValue({
      submissions: [{ submission: { submissionId: 'sub', currentStageName: 'Initial' }, applicantName: 'Applicant', applicationName: 'Application', stages: [], context: {}, completion: { reviewCompletion: [] }, decision: { action: 'move', diagnostics: [] } }],
      applicationNames: new Map(),
      stageNameById: new Map([['next', 'Next stage']])
    } as never)
    vi.spyOn(routingActions, 'resolveRoutingActions').mockReturnValue({ move: { toStageId: 'next', reason: 'Ready' }, diagnostics: [] } as never)
    const move = vi.spyOn(submittable, 'moveSubmissionsToStage')
    const label = vi.spyOn(submittable, 'addSubmissionLabelBulk')
    const editing = vi.spyOn(submittable, 'openSubmissionsForEditing')
    const result = await executeRoutingRun({ cycleId: 'cycle', actor: 'actor', dryRun: true })
    expect(result).toMatchObject({ moves: 1, movedSubmissions: [{ submissionId: 'sub', toStage: 'Next stage', reason: 'Ready' }] })
    expect(move).not.toHaveBeenCalled()
    expect(label).not.toHaveBeenCalled()
    expect(editing).not.toHaveBeenCalled()
  })

  it('uses fixed batch IDs rather than reapplying a mutable label filter', async () => {
    vi.spyOn(SubmissionModel, 'find').mockReturnValue({ sort: () => ({ select: () => ({ limit: () => ({ lean: async () => [] }) }) }) } as never)
    await executeRoutingRun({ cycleId: 'cycle', applicationId: 'app', labelId: 'old-label', submissionIds: ['sub'], limit: 1, actor: 'actor', dryRun: true })
    expect(SubmissionModel.find).toHaveBeenCalledWith({ cycleId: 'cycle', applicationId: 'app', submissionId: { $in: ['sub'] } })
  })
})
