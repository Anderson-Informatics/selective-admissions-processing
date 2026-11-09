import { beforeEach, describe, expect, it, vi } from 'vitest'
import { JobScheduleModel, ScheduleCycleModel, ScheduleRunModel } from '../models/JobSchedule'
import { CycleModel } from '../models/Cycle'
import { JobModel } from '../models/Job'
import { hasPartialResult, tickJobSchedules } from './jobScheduler'

const now = new Date('2026-11-09T12:00:00Z')
const run = { _id: 'run', cycleId: 'cycle', scheduleId: 'schedule', name: 'Morning', status: 'running', steps: ['run_validation', 'refresh_review_completion'], stepIndex: 0, actor: 'actor', partial: false }
const job = { _id: 'job', type: 'run_validation', status: 'completed', workerSettled: true, result: {} }
const lean = (value: unknown) => ({ lean: async () => value })
const sorted = (value: unknown) => ({ sort: () => ({ ...lean(value), limit: () => lean(value) }) })
beforeEach(() => {
  vi.restoreAllMocks()
  for (const model of [JobScheduleModel, ScheduleCycleModel, ScheduleRunModel, JobModel]) vi.spyOn(model, 'init').mockResolvedValue(model as never)
  vi.spyOn(JobScheduleModel, 'find').mockReturnValue(sorted([]) as never)
  vi.spyOn(ScheduleRunModel, 'distinct').mockResolvedValue(['cycle'])
  vi.spyOn(ScheduleCycleModel, 'updateOne').mockResolvedValue({} as never)
  vi.spyOn(ScheduleCycleModel, 'findOne').mockReturnValue(lean({ cycleId: 'cycle', runId: 'run' }) as never)
  vi.spyOn(ScheduleCycleModel, 'findOneAndUpdate').mockReturnValue(lean({ cycleId: 'cycle', runId: 'run' }) as never)
  vi.spyOn(ScheduleRunModel, 'findById').mockReturnValue(lean(run) as never)
  vi.spyOn(ScheduleRunModel, 'findOne').mockReturnValue(sorted(run) as never)
  vi.spyOn(ScheduleRunModel, 'updateOne').mockResolvedValue({} as never)
  vi.spyOn(JobModel, 'findOne').mockReturnValue(lean(job) as never)
  vi.spyOn(JobModel, 'find').mockReturnValue(lean([job]) as never)
  vi.spyOn(JobModel, 'updateOne').mockResolvedValue({} as never)
  vi.spyOn(JobModel, 'updateMany').mockResolvedValue({} as never)
  vi.spyOn(JobModel, 'exists').mockResolvedValue(null)
})
describe('durable scheduled chains', () => {
  it('advances settled steps with a conditional index update', async () => {
    await tickJobSchedules(now)
    expect(ScheduleRunModel.updateOne).toHaveBeenCalledWith({ _id: 'run', stepIndex: 0, status: 'running' }, expect.objectContaining({ $inc: { stepIndex: 1 } }))
  })
  it.each(['pending', 'waiting', 'running'])('waits for %s children and dependencies', async (status) => {
    vi.mocked(JobModel.find).mockReturnValue(lean([job, { ...job, status }]) as never)
    await tickJobSchedules(now)
    expect(ScheduleRunModel.updateOne).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ $inc: expect.anything() }))
  })
  it('waits through transient worker failure finalization', async () => {
    vi.mocked(JobModel.find).mockReturnValue(lean([{ ...job, status: 'failed', workerSettled: false }]) as never)
    await tickJobSchedules(now)
    expect(ScheduleRunModel.updateOne).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ $inc: expect.anything() }))
  })
  it('continues partial results and recognizes nested essay failures', async () => {
    vi.mocked(JobModel.find).mockReturnValue(lean([{ ...job, result: { failures: 2 } }]) as never)
    await tickJobSchedules(now)
    expect(ScheduleRunModel.updateOne).toHaveBeenCalledWith(expect.objectContaining({ stepIndex: 0 }), expect.objectContaining({ $set: expect.objectContaining({ partial: true }), $inc: { stepIndex: 1 } }))
    expect(hasPartialResult({ routing: { failures: [{}] } })).toBe(true)
    expect(hasPartialResult({ labelSync: { failures: [{}] } })).toBe(true)
    expect(hasPartialResult({ failures: [] })).toBe(false)
  })
  it('holds the cycle after uncertain external effects', async () => {
    vi.mocked(JobModel.find).mockReturnValue(lean([{ ...job, status: 'failed', result: { requiresReview: true } }]) as never)
    await tickJobSchedules(now)
    expect(ScheduleCycleModel.updateOne).toHaveBeenCalledWith({ cycleId: 'cycle', runId: 'run' }, { $set: { hold: expect.stringContaining('review') } })
    expect(ScheduleRunModel.updateOne).toHaveBeenCalledWith(expect.anything(), { $set: expect.objectContaining({ status: 'failed' }) })
  })
  it('does not execute held cycles', async () => {
    vi.mocked(ScheduleCycleModel.findOne).mockReturnValue(lean({ hold: 'review' }) as never)
    await tickJobSchedules(now)
    expect(JobModel.findOne).not.toHaveBeenCalled()
  })
  it('claims the earliest queued run with atomic cycle ownership', async () => {
    vi.mocked(ScheduleCycleModel.findOne).mockReturnValue(lean({ cycleId: 'cycle' }) as never)
    await tickJobSchedules(now)
    expect(ScheduleCycleModel.findOneAndUpdate).toHaveBeenCalledWith({ cycleId: 'cycle', runId: { $exists: false }, hold: { $exists: false } }, { $set: { runId: 'run' } }, { returnDocument: 'after' })
  })
  it('marks the last step partial instead of claiming full success', async () => {
    vi.mocked(ScheduleRunModel.findById).mockReturnValue(lean({ ...run, steps: ['run_routing'] }) as never)
    vi.mocked(JobModel.find).mockReturnValue(lean([{ ...job, result: { failures: 1 } }]) as never)
    await tickJobSchedules(now)
    expect(ScheduleRunModel.updateOne).toHaveBeenCalledWith(expect.objectContaining({ status: 'running' }), expect.objectContaining({ $set: expect.objectContaining({ status: 'partial', completedAt: now }) }))
  })
  it('stops an exhausted ordinary failure without holding the cycle', async () => {
    vi.mocked(JobModel.find).mockReturnValue(lean([{ ...job, status: 'failed', error: 'exhausted' }]) as never)
    await tickJobSchedules(now)
    expect(ScheduleRunModel.updateOne).toHaveBeenCalledWith(expect.objectContaining({ stepIndex: 0 }), { $set: expect.objectContaining({ status: 'failed', message: 'exhausted' }) })
    expect(ScheduleCycleModel.updateOne).toHaveBeenCalledWith({ cycleId: 'cycle', runId: 'run' }, { $unset: { runId: 1 } })
  })
  it('activates refresh dependencies only after the root settles', async () => {
    vi.mocked(JobModel.findOne).mockReturnValue(lean({ ...job, status: 'running', workerSettled: false }) as never)
    vi.mocked(JobModel.find).mockReturnValue(lean([{ ...job, status: 'running' }, { ...job, status: 'waiting' }]) as never)
    await tickJobSchedules(now)
    expect(JobModel.updateMany).not.toHaveBeenCalled()
    vi.mocked(JobModel.findOne).mockReturnValue(lean(job) as never)
    await tickJobSchedules(now)
    expect(JobModel.updateMany).toHaveBeenCalledWith({ dependencyOf: 'job', status: 'waiting' }, { $set: { status: 'pending' } })
  })
  it('does not enqueue a competing step when a manual lock is active', async () => {
    vi.mocked(ScheduleRunModel.findById).mockReturnValue(lean({ ...run, steps: ['run_routing'] }) as never)
    vi.mocked(JobModel.findOne).mockReturnValue(lean(null) as never)
    vi.mocked(JobModel.exists).mockResolvedValue({ _id: 'manual' } as never)
    await tickJobSchedules(now)
    expect(JobModel.updateOne).not.toHaveBeenCalled()
    expect(ScheduleRunModel.updateOne).toHaveBeenCalledWith(expect.anything(), { $set: { message: expect.stringContaining('manual') } })
  })
  it('repairs a missing step link by creating work under a deterministic key', async () => {
    vi.mocked(JobModel.findOne).mockReturnValueOnce(lean(null) as never).mockReturnValue(lean({ ...job, status: 'pending' }) as never)
    await tickJobSchedules(now)
    expect(JobModel.updateOne).toHaveBeenCalledWith({ executionKey: 'run:0' }, { $setOnInsert: expect.objectContaining({ scheduleRunId: 'run', scheduleStep: 0, type: 'run_validation' }) }, { upsert: true })
  })
  it('does not generate retroactive occurrences on first enable', async () => {
    vi.mocked(JobScheduleModel.find).mockReturnValue(sorted([{ _id: 'schedule', time: '06:00', eligibleAfter: now }]) as never)
    await tickJobSchedules(now)
    expect(ScheduleRunModel.updateOne).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), { upsert: true })
  })
  it('records a skipped occurrence when the active cycle is ambiguous', async () => {
    vi.mocked(JobScheduleModel.find).mockReturnValue(sorted([{ _id: 'schedule', name: 'Morning', time: '06:00', eligibleAfter: new Date('2026-11-08'), steps: ['run_validation'] }]) as never)
    vi.spyOn(CycleModel, 'find').mockReturnValue({ select: () => ({ limit: () => lean([{ _id: 'one' }, { _id: 'two' }]) }) } as never)
    await tickJobSchedules(now)
    expect(ScheduleRunModel.updateOne).toHaveBeenCalledWith({ scheduleId: 'schedule', localDate: '2026-11-09' }, { $setOnInsert: expect.objectContaining({ status: 'skipped' }) }, { upsert: true })
  })
  it('creates one per-chain occurrence and snapshots the active cycle', async () => {
    vi.mocked(JobScheduleModel.find).mockReturnValue(sorted([{ _id: 'schedule', name: 'Morning', time: '06:00', enabled: true, eligibleAfter: new Date('2026-11-08'), steps: ['run_validation'], updatedBy: 'actor', revision: 2 }]) as never)
    vi.spyOn(CycleModel, 'find').mockReturnValue({ select: () => ({ limit: () => lean([{ _id: 'cycle' }]) }) } as never)
    await tickJobSchedules(now)
    expect(ScheduleRunModel.updateOne).toHaveBeenCalledWith({ scheduleId: 'schedule', localDate: '2026-11-09' }, { $setOnInsert: expect.objectContaining({ cycleId: 'cycle', revision: 2, status: 'queued' }) }, { upsert: true })
  })
})
