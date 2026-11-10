import { AuditLogModel } from '../models/AuditLog'

// FERPA 34 CFR §99.32 requires a record of each disclosure of education records.
// These actions cover exports, external data-API responses, and outbound messages.
export async function recordDisclosure(input: {
  actor: string
  action: 'pii_export' | 'data_api_disclosure' | 'applicant_message_sent'
  entityType: string
  entityId: string
  detail?: Record<string, unknown>
}) {
  await AuditLogModel.create({
    action: input.action,
    actor: input.actor,
    entityType: input.entityType,
    entityId: input.entityId,
    changes: input.detail ? [{ path: 'detail', after: input.detail }] : []
  })
}
