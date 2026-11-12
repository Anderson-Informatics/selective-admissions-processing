export function isWithdrawnSubmission(submission: { status?: string }): boolean {
  return /^withdrawn$/i.test(String(submission.status || '').trim())
}

export const activeSubmissionFilter = () => ({ status: { $not: /^withdrawn$/i } })
