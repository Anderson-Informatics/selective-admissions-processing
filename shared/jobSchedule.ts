import { z } from 'zod'

export const scheduledJobs = [
  { type: 'metadata_sync', label: 'Metadata sync' },
  { type: 'submission_extraction', label: 'Submission extraction' },
  { type: 'form_response_mapping', label: 'Form response mapping' },
  { type: 'catchment_lookup', label: 'Catchment lookup' },
  { type: 'run_validation', label: 'Run validation' },
  { type: 'refresh_review_completion', label: 'Refresh review completion' },
  { type: 'run_routing', label: 'Run routing' },
  { type: 'essay_begin_scoring', label: 'Essay — Begin Scoring' },
  { type: 'essay_update_scoring', label: 'Essay — Update Scoring' },
  { type: 'essay_finish_scoring', label: 'Essay — Finish Scoring' },
  { type: 'registration_sync', label: 'Registration sync' }
] as const
export type ScheduledJobType = typeof scheduledJobs[number]['type']
export const prerequisites: Partial<Record<ScheduledJobType, ScheduledJobType>> = {
  form_response_mapping: 'submission_extraction',
  run_routing: 'refresh_review_completion',
  registration_sync: 'run_validation'
}
export function orderError(steps: ScheduledJobType[]): string | undefined {
  if (!steps.length) return 'Select at least one job'
  if (new Set(steps).size !== steps.length) return 'Jobs cannot be repeated'
  for (const [dependent, prerequisite] of Object.entries(prerequisites)) {
    if (steps.includes(dependent as ScheduledJobType) && (!steps.includes(prerequisite) || steps.indexOf(prerequisite) > steps.indexOf(dependent as ScheduledJobType))) return `${prerequisite} must precede ${dependent}`
  }
  if (steps.includes('catchment_lookup') && steps.includes('run_validation') && steps.indexOf('catchment_lookup') > steps.indexOf('run_validation')) return 'Catchment lookup must precede validation'
}
export function selectScheduledJob(steps: ScheduledJobType[], type: ScheduledJobType): ScheduledJobType[] {
  const next = [...steps]
  const prerequisite = prerequisites[type]
  if (prerequisite && !next.includes(prerequisite)) next.push(prerequisite)
  if (!next.includes(type)) next.push(type)
  if (next.includes('catchment_lookup') && next.includes('run_validation') && next.indexOf('catchment_lookup') > next.indexOf('run_validation')) {
    next.splice(next.indexOf('catchment_lookup'), 1)
    next.splice(next.indexOf('run_validation'), 0, 'catchment_lookup')
  }
  return next
}
export const scheduleSchema = z.object({
  name: z.string().trim().min(1).max(100),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  enabled: z.boolean(),
  steps: z.array(z.enum(scheduledJobs.map(job => job.type) as [ScheduledJobType, ...ScheduledJobType[]])).min(1).max(10),
  dryRun: z.boolean(),
  acknowledged: z.boolean(),
  revision: z.number().int().min(0)
}).strict().superRefine((value, ctx) => {
  const error = orderError(value.steps)
  if (error) ctx.addIssue({ code: 'custom', message: error, path: ['steps'] })
  if (value.enabled && !value.acknowledged && value.steps.some(type => type.startsWith('essay_') || (type === 'registration_sync' && !value.dryRun) || (type === 'run_routing' && !value.dryRun))) ctx.addIssue({ code: 'custom', message: 'Acknowledge external submission changes before enabling', path: ['acknowledged'] })
})
export type ScheduleInput = z.infer<typeof scheduleSchema>
