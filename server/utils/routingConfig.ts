import { z } from 'zod'

export const reviewStageRoleSchema = z.enum(['initial', 'work', 'hold', 'final'])

// The recursive schema requires a broad intermediate type before inference.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const conditionGroupSchema: z.ZodType<any> = z.lazy(() => z.object({
  all: z.array(z.union([conditionSchema, conditionGroupSchema])).default([]),
  any: z.array(z.union([conditionSchema, conditionGroupSchema])).optional()
}).strict())

const conditionSchema = z.object({
  kind: z.enum([
    'field', 'label', 'reviewField', 'reviewScore', 'reviewCount',
    'reviewSpread', 'hsptLinked', 'gpaRecord', 'gpaStatus',
    'mappedInitialForm', 'pipelinePrerequisitesComplete', 'cycleRound'
  ]),
  name: z.string().optional(),
  field: z.string().optional(),
  stageId: z.string().optional(),
  stageIds: z.array(z.string()).optional(),
  scope: z.enum(['latestCompleted', 'latestSubmitted', 'latest', 'any', 'all']).optional(),
  op: z.enum(['eq', 'ne', 'in', 'nin', 'gte', 'gt', 'lte', 'lt', 'isNull', 'notNull', 'hasLabel', 'lacksLabel']).optional(),
  value: z.unknown().optional(),
  statusIn: z.array(z.string()).optional(),
  labelId: z.string().optional(),
  source: z.enum(['dpscd', 'optIn', 'any']).optional(),
  quartersAvailable: z.number().optional(),
  termsEnrolled: z.number().optional(),
  exists: z.boolean().optional()
}).strict()

export { conditionGroupSchema }

export const statusRuleSchema = z.object({
  name: z.string().min(1),
  when: conditionGroupSchema.optional(),
  status: z.string().min(1),
  complete: z.boolean()
}).strict()

export const routingRuleSchema = z.object({
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  when: conditionGroupSchema,
  moveToStageId: z.string().optional(),
  addLabelIds: z.array(z.string()).optional(),
  removeLabelIds: z.array(z.string()).optional(),
  assignUserIds: z.array(z.string()).optional(),
  unassignUserIds: z.array(z.string()).optional()
}).strict()

export const actionSchema = z.object({
  when: conditionGroupSchema.optional(),
  addLabelIds: z.array(z.string()).optional(),
  removeLabelIds: z.array(z.string()).optional(),
  assignUserIds: z.array(z.string()).optional(),
  unassignUserIds: z.array(z.string()).optional(),
  setFields: z.record(z.unknown()).optional(),
  openForEditing: z.object({
    subjectTemplate: z.string().optional(),
    messageTemplate: z.string().optional(),
    variables: z.array(z.string()).optional()
  }).optional(),
  closeForEditing: z.object({
    internalNoteTemplate: z.string().optional(),
    subjectTemplate: z.string().optional(),
    messageTemplate: z.string().optional()
  }).optional()
}).strict()

export const entryActionSchema = actionSchema
export const exitActionSchema = actionSchema

export const routingConfigSchema = z.object({
  enabled: z.boolean().default(false),
  requiredWhen: conditionGroupSchema.optional(),
  allowedStatuses: z.array(z.string().min(1)).optional(),
  statusRules: z.array(statusRuleSchema).default([]),
  statusLabels: z.record(z.string()).optional(),
  outcomeRules: z.array(routingRuleSchema).default([]),
  entryActions: z.array(entryActionSchema).default([]),
  exitActions: z.array(exitActionSchema).default([])
}).strict()

export type RoutingConfig = z.infer<typeof routingConfigSchema>
export type ConditionGroup = z.infer<typeof conditionGroupSchema>

export const defaultRoutingConfig: RoutingConfig = {
  enabled: false,
  statusRules: [],
  outcomeRules: [],
  entryActions: [],
  exitActions: []
}

export function normalizeRoutingConfig(value: unknown): RoutingConfig {
  return routingConfigSchema.parse(value || defaultRoutingConfig)
}

export function parseRoutingJson(value: string): RoutingConfig {
  return normalizeRoutingConfig(JSON.parse(value))
}

export function collectReferencedStageIds(value: unknown): string[] {
  const ids = new Set<string>()
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      node.forEach(visit)
      return
    }
    const record = node as Record<string, unknown>
    if (typeof record.stageId === 'string') ids.add(record.stageId)
    if (Array.isArray(record.stageIds)) record.stageIds.filter((id): id is string => typeof id === 'string').forEach(id => ids.add(id))
    Object.values(record).forEach(visit)
  }
  visit(value)
  return [...ids]
}
