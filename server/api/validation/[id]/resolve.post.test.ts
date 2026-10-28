import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ValidationIssueModel } from '../../../models/ValidationIssue'
import { reconcileValidationLabelsForSubmission } from '../../../utils/validationLabels'

vi.mock('../../../utils/validationLabels', () => ({ reconcileValidationLabelsForSubmission: vi.fn() }))

let handler: (event: unknown) => Promise<unknown>

beforeAll(async () => {
  vi.stubGlobal('defineEventHandler', (fn: typeof handler) => fn)
  handler = (await import('./resolve.post')).default as typeof handler
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('connectDb', vi.fn())
  vi.stubGlobal('requireAuth', vi.fn().mockResolvedValue({ email: 'admin@example.test' }))
  vi.stubGlobal('getRouterParams', () => ({ id: 'issue-1' }))
  vi.stubGlobal('createError', ({ statusCode, statusMessage }: { statusCode: number, statusMessage: string }) =>
    Object.assign(new Error(statusMessage), { statusCode }))
  vi.spyOn(ValidationIssueModel, 'findByIdAndUpdate').mockReturnValue({
    lean: async () => ({ _id: 'issue-1', cycleId: 'cycle-1', submissionId: 'sub-1', status: 'resolved' })
  } as never)
})

describe('manual validation override', () => {
  it('reconciles the submission immediately after resolving the issue', async () => {
    await handler({})
    expect(reconcileValidationLabelsForSubmission).toHaveBeenCalledWith('cycle-1', 'sub-1')
  })

  it('reports a label sync failure without undoing the saved override', async () => {
    vi.mocked(reconcileValidationLabelsForSubmission).mockRejectedValueOnce(new Error('remote failed'))
    await expect(handler({})).rejects.toMatchObject({ statusCode: 502, message: expect.stringContaining('label') })
    expect(ValidationIssueModel.findByIdAndUpdate).toHaveBeenCalledOnce()
  })
})
