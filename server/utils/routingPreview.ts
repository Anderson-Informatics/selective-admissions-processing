export function applicantName(fields: Record<string, unknown>, submissionId: string): string {
  const name = (value: unknown) => typeof value === 'string' ? value.trim() : ''
  return name(fields.FullName) || [name(fields.FirstName), name(fields.LastName)].filter(Boolean).join(' ') || submissionId
}

export function routingPreviewFilter(cycleId: string, applicationId?: string, labelId?: string): Record<string, string> {
  return {
    cycleId,
    ...(applicationId ? { applicationId } : {}),
    ...(labelId ? { labelIds: labelId } : {})
  }
}
