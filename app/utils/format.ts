// SSR-safe formatting: pin locale/timezone so server and client render identically.
const LOCALE = 'en-US'
const TIME_ZONE = 'America/Detroit'

export function formatDateTime(value?: string | Date | null, fallback = '—') {
  return value ? new Date(value).toLocaleString(LOCALE, { timeZone: TIME_ZONE, timeZoneName: 'short' }) : fallback
}

export function formatDateOnly(value?: string | Date | null, fallback = '—') {
  return value ? new Date(value).toLocaleDateString(LOCALE, { timeZone: TIME_ZONE }) : fallback
}

/** Elapsed time like "3m 12s" or "45s". Uses the current time when `end` is missing. */
export function formatDuration(start?: string | Date | null, end?: string | Date | null) {
  if (!start) return '—'
  const ms = new Date(end || Date.now()).getTime() - new Date(start).getTime()
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  return minutes ? `${minutes}m ${totalSeconds % 60}s` : `${totalSeconds}s`
}

export function formatNumber(value: number) {
  return value.toLocaleString(LOCALE)
}
