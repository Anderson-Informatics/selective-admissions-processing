import { z } from 'zod'
import { SchoolModel } from '../models/School'
import { SchoolRepresentativeModel } from '../models/SchoolRepresentative'
import { SchoolAuthorityModel, type SchoolAuthority } from '../models/SchoolAuthority'
import { MetadataModel } from '../models/Metadata'
import { AuditLogModel } from '../models/AuditLog'

export const schoolKey = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase()
const id = z.string().trim().min(1)
export const schoolSchema = z.object({ name: id, aliases: z.array(id).default([]), active: z.boolean().default(true) })
export const representativeSchema = z.object({ userId: id, schoolIds: z.array(id).refine(values => new Set(values).size === values.length), active: z.boolean().default(true) })
export const authoritySchema = z.object({ cycleId: id, applicationId: z.string().default(''), schoolId: id, userId: id })

export function effectiveAuthorities(authorities: SchoolAuthority[], cycleId: string, applicationId: string) {
  const effective = new Map<string, SchoolAuthority>()
  for (const scope of ['', applicationId]) {
    for (const authority of authorities) {
      if (authority.cycleId === cycleId && authority.applicationId === scope) effective.set(authority.schoolId, authority)
    }
  }
  return [...effective.values()]
}

export async function loadSchoolDirectory(cycleId: string, applicationId = '') {
  const [schools, representatives, authorities, members] = await Promise.all([
    SchoolModel.find().sort({ name: 1 }).lean(),
    SchoolRepresentativeModel.find().sort({ userId: 1 }).lean(),
    SchoolAuthorityModel.find({ cycleId, applicationId: { $in: ['', applicationId] } }).sort({ schoolId: 1, applicationId: 1 }).lean(),
    MetadataModel.find({ type: 'team' }).select('externalId name data.name data.title data.email syncedAt').lean()
  ])
  return {
    schools: schools.map(school => ({ ...school, id: String(school._id) })),
    representatives,
    authorities,
    effectiveAuthorities: effectiveAuthorities(authorities, cycleId, applicationId),
    members: members.map((member) => {
      const rawName = member.data?.name
      const nameParts = rawName && typeof rawName === 'object' ? rawName as Record<string, unknown> : {}
      const part = (key: string) => typeof nameParts[key] === 'string' ? (nameParts[key] as string).trim() || undefined : undefined
      const fullName = part('full')
      return {
        userId: member.externalId,
        name: fullName || member.name || member.externalId,
        firstName: part('first'),
        lastName: part('last'),
        title: typeof member.data?.title === 'string' ? member.data.title.trim() || undefined : undefined,
        email: typeof member.data?.email === 'string' ? member.data.email.trim() || undefined : undefined,
        syncedAt: member.syncedAt
      }
    })
  }
}

export async function auditDirectory(actor: string, entityType: string, entityId: string, before: unknown, after: unknown, cycleId?: string) {
  await AuditLogModel.create({ actor, action: `${entityType}_updated`, entityType, entityId, cycleId, changes: [{ path: 'configuration', before, after }] })
}
