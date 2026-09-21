import { z } from 'zod'

export const cycleRoundInputSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  order: z.number().int().min(1),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  active: z.boolean().default(true)
}).strict()

export type CycleRoundInput = z.infer<typeof cycleRoundInputSchema>

export function normalizeCycleRounds(value: unknown): CycleRoundInput[] {
  if (!Array.isArray(value)) return []
  const rounds = value.map(round => cycleRoundInputSchema.parse(round)).sort((a, b) => a.order - b.order)
  const keys = new Set<string>()
  for (let index = 0; index < rounds.length; index += 1) {
    const round = rounds[index]!
    if (keys.has(round.key)) throw new Error(`Duplicate round key: ${round.key}`)
    keys.add(round.key)
    if (round.endDate < round.startDate) throw new Error(`Round ${round.name} ends before it starts`)
    const previous = rounds[index - 1]
    if (previous && round.startDate <= previous.endDate) throw new Error(`Round ${round.name} overlaps ${previous.name}`)
  }
  return rounds
}

export function resolveCycleRound(dateValue: unknown, rounds: CycleRoundInput[]) {
  if (!dateValue) return { key: undefined, name: undefined, status: 'missing_submission_date' as const }
  const date = new Date(String(dateValue))
  if (Number.isNaN(date.getTime())) return { key: undefined, name: undefined, status: 'missing_submission_date' as const }
  const round = rounds.find(item => date >= item.startDate && date <= item.endDate && item.active)
  if (!round) return { key: undefined, name: undefined, status: 'outside_configured_ranges' as const }
  return { key: round.key, name: round.name, status: 'matched' as const }
}
