const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6
}

const OFFSET_PATTERN = /^(\d+)\s*(calendar|business)?\s*(days?|weeks?)$/i
const SNAP_PATTERN = /^snap(?:\s+to)?\s+([a-z]+)$/i

const DETROIT_PARTS = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Detroit', year: 'numeric', month: '2-digit', day: '2-digit' })
const DISPLAY = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

const DAY_MS = 24 * 60 * 60 * 1000

function detroitToday(now: Date): Date {
  const parts = Object.fromEntries(DETROIT_PARTS.formatToParts(now).map(part => [part.type, part.value]))
  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)))
}

function isWeekday(date: Date): boolean {
  const day = date.getUTCDay()
  return day >= 1 && day <= 5
}

export interface DeadlineSpec {
  count: number
  unit: 'days' | 'weeks'
  business: boolean
  snapTo?: number
}

/** Parses a spec like "2 weeks | snap friday" or "10 business days". Returns null when invalid. */
export function parseDeadlineSpec(spec: string | undefined): DeadlineSpec | null {
  const result: DeadlineSpec = { count: 0, unit: 'days', business: false }
  const segments = (spec || '').split('|').map(segment => segment.trim()).filter(Boolean)
  for (const segment of segments) {
    const offset = OFFSET_PATTERN.exec(segment)
    if (offset && result.count === 0) {
      result.count = Number(offset[1])
      result.business = (offset[2] || '').toLowerCase() === 'business'
      result.unit = /^week/i.test(offset[3] || '') ? 'weeks' : 'days'
      continue
    }
    const snap = SNAP_PATTERN.exec(segment)
    if (snap && result.snapTo === undefined) {
      const weekday = WEEKDAYS[(snap[1] || '').toLowerCase()]
      if (weekday === undefined) return null
      result.snapTo = weekday
      continue
    }
    return null
  }
  return result
}

export function resolveDeadlineDate(spec: DeadlineSpec, now: Date): Date {
  let date = detroitToday(now)
  if (spec.business) {
    let remaining = spec.unit === 'weeks' ? spec.count * 5 : spec.count
    while (remaining > 0) {
      date = new Date(date.getTime() + DAY_MS)
      if (isWeekday(date)) remaining -= 1
    }
  } else {
    date = new Date(date.getTime() + (spec.unit === 'weeks' ? spec.count * 7 : spec.count) * DAY_MS)
  }
  if (spec.snapTo !== undefined) {
    while (date.getUTCDay() !== spec.snapTo) {
      date = new Date(date.getTime() + DAY_MS)
    }
  }
  return date
}

export function formatDeadlineDate(date: Date): string {
  return DISPLAY.format(date)
}

/** Renders a `{{deadline | ...}}` spec against `now`. Returns null when the spec is invalid. */
export function renderDeadline(spec: string | undefined, now: Date): string | null {
  const parsed = parseDeadlineSpec(spec)
  if (!parsed) return null
  return formatDeadlineDate(resolveDeadlineDate(parsed, now))
}
