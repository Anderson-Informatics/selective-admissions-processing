import { z } from 'zod'

export const DEFAULT_PREFERENCE_FIELDS = ['FirstChoiceSchool', 'SecondChoiceSchool', 'ThirdChoiceSchool', 'FourthChoiceSchool', 'FifthChoiceSchool']
export const decisionValueKey = (value: unknown) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLowerCase() : typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
const unique = (values: string[]) => new Set(values).size === values.length
const values = z.array(z.union([z.string().trim().min(1), z.number().finite()])).default([])
export const decisionConfigSchema = z.object({
  preferenceFields: z.array(z.string().trim().min(1)).min(1).refine(unique, 'Preference fields must be unique'),
  schoolIds: z.array(z.string().min(1)).min(1).refine(unique, 'Schools must be unique'),
  sources: z.array(z.object({
    stageId: z.string().min(1),
    kind: z.enum(['field', 'score']),
    field: z.string().optional(),
    accept: values,
    decline: values,
    waitlist: values
  }).superRefine((source, ctx) => {
    if (source.kind === 'field' && !source.field?.trim()) ctx.addIssue({ code: 'custom', message: 'Select a mapped decision field' })
    const keys = [...source.accept, ...source.decline, ...source.waitlist].map(decisionValueKey)
    if (!keys.length || keys.some(key => !key) || !unique(keys)) ctx.addIssue({ code: 'custom', message: 'Outcome mappings must be nonempty and distinct' })
    if (source.kind === 'score' && [...source.accept, ...source.decline, ...source.waitlist].some(value => typeof value !== 'number')) ctx.addIssue({ code: 'custom', message: 'Score mappings must be numbers' })
  })).min(1)
}).superRefine((config, ctx) => {
  if (!unique(config.sources.map(source => source.stageId))) ctx.addIssue({ code: 'custom', message: 'Configure each decision stage only once' })
})
export type DecisionConfig = z.infer<typeof decisionConfigSchema>

export function rewriteDecisionStageIds(config: DecisionConfig, remap: Map<string, string>): DecisionConfig {
  return { ...config, sources: config.sources.map(source => ({ ...source, stageId: remap.get(source.stageId) || source.stageId })) }
}
