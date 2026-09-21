import { createHash } from 'node:crypto'
import { AuditLogModel } from '../models/AuditLog'

function stableJson(value: unknown) {
  return JSON.stringify(value, Object.keys(value as object).sort())
}

export function configHash(value: unknown) {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

export function configChanges(before: Record<string, unknown>, after: Record<string, unknown>) {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
  return keys.filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key])).map(path => ({
    path,
    before: before[path],
    after: after[path]
  }))
}

export async function recordConfigAudit(input: {
  actor: string
  cycleId: string
  applicationId: string
  entityId: string
  before: Record<string, unknown>
  after: Record<string, unknown>
}) {
  const changes = configChanges(input.before, input.after)
  if (!changes.length) return
  await AuditLogModel.create({
    action: 'routing_configuration_updated',
    actor: input.actor,
    cycleId: input.cycleId,
    applicationId: input.applicationId,
    entityType: 'application',
    entityId: input.entityId,
    changes,
    beforeHash: configHash(input.before),
    afterHash: configHash(input.after)
  })
}
