import { describe, expect, it } from 'vitest'
import { orderError, scheduleSchema, selectScheduledJob } from './jobSchedule'

const input = { name: 'Morning', time: '06:00', enabled: false, steps: ['submission_extraction', 'form_response_mapping'], dryRun: true, acknowledged: false, revision: 0 }
describe('scheduled job selection', () => {
  it('adds extraction before mapping without forcing routing', () => {
    expect(selectScheduledJob([], 'form_response_mapping')).toEqual(['submission_extraction', 'form_response_mapping'])
  })
  it('adds refresh before routing', () => {
    expect(selectScheduledJob([], 'run_routing')).toEqual(['refresh_review_completion', 'run_routing'])
  })
  it('inserts catchment before existing validation', () => {
    expect(selectScheduledJob(['run_validation'], 'catchment_lookup')).toEqual(['catchment_lookup', 'run_validation'])
  })
  it('permits standalone validation but rejects invalid ordering', () => {
    expect(orderError(['run_validation'])).toBeUndefined()
    expect(orderError(['run_validation', 'catchment_lookup'])).toContain('Catchment')
    expect(orderError(['form_response_mapping'])).toContain('submission_extraction')
    expect(orderError(['form_response_mapping', 'submission_extraction'])).toBeDefined()
    expect(orderError(['run_routing'])).toBeDefined()
  })
  it('validates supported types, unique steps and strict payloads', () => {
    expect(scheduleSchema.safeParse(input).success).toBe(true)
    for (const steps of [['score_compilation'], ['submission_extraction_form'], ['hspt_upload_commit'], ['run_validation', 'run_validation']]) expect(scheduleSchema.safeParse({ ...input, steps }).success).toBe(false)
    expect(scheduleSchema.safeParse({ ...input, payload: {} }).success).toBe(false)
    expect(scheduleSchema.safeParse({ ...input, time: '24:00' }).success).toBe(false)
  })
  it('requires acknowledgement for live external workflows', () => {
    const routing = { ...input, steps: ['refresh_review_completion', 'run_routing'], enabled: true, dryRun: false }
    expect(scheduleSchema.safeParse(routing).success).toBe(false)
    expect(scheduleSchema.safeParse({ ...routing, acknowledged: true }).success).toBe(true)
    expect(scheduleSchema.safeParse({ ...routing, dryRun: true }).success).toBe(true)
    expect(scheduleSchema.safeParse({ ...input, steps: ['essay_update_scoring'], enabled: true }).success).toBe(false)
  })
})
