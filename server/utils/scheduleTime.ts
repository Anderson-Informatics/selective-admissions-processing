const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Detroit', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

export function detroitParts(date: Date) {
  const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]))
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` }
}
const occurrences = new Map<string, number>()
export function occurrenceOn(localDate: string, time: string) {
  const key = `${localDate}:${time}`
  const cached = occurrences.get(key)
  if (cached != null) return new Date(cached)
  const start = Date.parse(`${localDate}T00:00:00Z`)
  for (let offset = 0; offset < 30 * 60; offset++) {
    const instant = new Date(start + offset * 60_000)
    const local = detroitParts(instant)
    if (local.date === localDate && local.time >= time) {
      if (occurrences.size >= 1000) occurrences.clear()
      occurrences.set(key, instant.getTime())
      return instant
    }
  }
  throw new Error('Unable to resolve scheduled local time')
}
export function nextOccurrence(time: string, after: Date) {
  const today = detroitParts(after).date
  const due = occurrenceOn(today, time)
  if (due > after) return due
  const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86400_000).toISOString().slice(0, 10)
  return occurrenceOn(tomorrow, time)
}
