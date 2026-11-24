// SSR-safe formatting: pin locale/timezone so server and client render identically.
const LOCALE = 'en-US'
const TIME_ZONE = 'America/Detroit'

export function formatDateTime(value?: string | Date | null, fallback = '—') {
  return value ? new Date(value).toLocaleString(LOCALE, { timeZone: TIME_ZONE, timeZoneName: 'short' }) : fallback
}

export function formatDateOnly(value?: string | Date | null, fallback = '—') {
  return value ? new Date(value).toLocaleDateString(LOCALE, { timeZone: TIME_ZONE }) : fallback
}

export function formatNumber(value: number) {
  return value.toLocaleString(LOCALE)
}
