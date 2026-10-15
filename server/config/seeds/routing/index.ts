import appHs from './app-hs.json'
import dsa from './dsa.json'
import ehs9 from './ehs-9th-grade.json'
import ehsCurrent from './ehs-current-hs.json'
import ehsTransfer from './ehs-transfer.json'
import { normalizeConditionGroup } from '../../../../shared/routingConditions'

const templates = {
  'app-hs': appHs,
  dsa,
  'ehs-9th-grade': ehs9,
  'ehs-current-hs': ehsCurrent,
  'ehs-transfer': ehsTransfer
} as const

function normalizeTemplate(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeTemplate)
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  if ('all' in record || 'any' in record) return normalizeTemplate(normalizeConditionGroup(record))
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, normalizeTemplate(item)]))
}

export const routingTemplates = Object.fromEntries(
  Object.entries(templates).map(([key, template]) => [key, normalizeTemplate(template)])
) as unknown as typeof templates

export type RoutingTemplateName = keyof typeof routingTemplates
