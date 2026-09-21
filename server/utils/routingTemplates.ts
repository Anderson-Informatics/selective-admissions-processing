/* eslint-disable @typescript-eslint/no-explicit-any */
import { routingTemplates } from '../config/seeds/routing'
import { defaultRoutingConfig, normalizeRoutingConfig, reviewStageRoleSchema } from './routingConfig'

export interface ResolvedTemplateStage {
  stageId: string
  role: 'initial' | 'work' | 'hold' | 'final'
  routing: ReturnType<typeof normalizeRoutingConfig>
}

export interface ResolvedRoutingTemplate {
  name: string
  draft: boolean
  warnings: string[]
  stages: ResolvedTemplateStage[]
}

function resolveReferences(value: unknown, stageByName: Map<string, string>, warnings: string[], path: string): unknown {
  if (Array.isArray(value)) return value.map((item, index) => resolveReferences(item, stageByName, warnings, `${path}[${index}]`))
  if (!value || typeof value !== 'object') return value

  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'stageName' || key === 'targetStageName') {
      const name = typeof child === 'string' ? child : ''
      const stageId = stageByName.get(name)
      if (!stageId) {
        warnings.push(`${path} references missing stage "${name}"`)
        continue
      }
      result[key === 'targetStageName' ? 'moveToStageId' : 'stageId'] = stageId
      continue
    }
    if (key === 'stageNames') {
      const names = Array.isArray(child) ? child : []
      result.stageIds = names.flatMap((name) => {
        const stageId = typeof name === 'string' ? stageByName.get(name) : undefined
        if (!stageId && typeof name === 'string') warnings.push(`${path} references missing stage "${name}"`)
        return stageId ? [stageId] : []
      })
      continue
    }
    result[key] = resolveReferences(child, stageByName, warnings, `${path}.${key}`)
  }
  return result
}

function defaultRole(stageName: string, index: number): 'initial' | 'work' | 'hold' | 'final' {
  if (index === 0) return 'initial'
  if (/accepted|declined|achiever/i.test(stageName)) return 'final'
  if (/pending|no exam/i.test(stageName)) return 'hold'
  return 'work'
}

export function resolveRoutingTemplate(templateKey: string, stages: Array<Record<string, any>>): ResolvedRoutingTemplate {
  const template = routingTemplates[templateKey as keyof typeof routingTemplates]
  if (!template) throw new Error(`Unknown routing template: ${templateKey}`)

  const stageByName = new Map(stages.map(stage => [stage.name, stage.stageId]))
  const templateStages = (template.stages || {}) as Record<string, { role?: string, routing?: unknown }>
  const warnings: string[] = []
  const resolvedStages = stages.map((stage, index) => {
    const configured = templateStages[stage.name]
    const rawRouting = configured?.routing ? resolveReferences(configured.routing, stageByName, warnings, stage.name) : defaultRoutingConfig
    let routing = normalizeRoutingConfig(rawRouting)
    if (template.draft) routing = { ...routing, enabled: false }
    return {
      stageId: stage.stageId,
      role: reviewStageRoleSchema.parse(configured?.role || defaultRole(stage.name, index)),
      routing
    }
  })

  return { name: template.name, draft: template.draft === true, warnings, stages: resolvedStages }
}
