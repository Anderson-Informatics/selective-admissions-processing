import { GpaRecordModel } from '../models/GpaRecord'

export function isWithdrawnSubmission(submission: { status?: string }): boolean {
  return /^withdrawn$/i.test(String(submission.status || '').trim())
}

export async function clearGpaRecordsForSubmissions(cycleId: string, submissionIds: string[], dryRun = false): Promise<number> {
  const ids = [...new Set(submissionIds.filter(Boolean))]
  if (!ids.length) return 0
  const filter = { cycleId, submissionId: { $in: ids } }
  if (dryRun) return GpaRecordModel.countDocuments(filter)
  const result = await GpaRecordModel.deleteMany(filter)
  return result.deletedCount || 0
}
