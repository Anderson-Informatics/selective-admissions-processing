import { MetadataModel } from '../models/Metadata'

// ---------------------------------------------------------------------------
// GPA score computation
//
// Ported from reference/Submittable_v4.py `gpa_calc`:
//   pts = banded table value for the cumulative GPA (30 max)
//   GPA_Score = (pts * multiplier) + gpa_bonus
// where gpa_bonus applies when the submission carries the "GPA Bonus Eligible"
// label, and multiplier comes from the Partial GPA review form's "Semesters"
// answer or the DPSCD "Quarters Available" count (see deriveGpaMultiplier).
// ---------------------------------------------------------------------------

export interface GpaTableBand {
  /** Points awarded when cumulative GPA is strictly greater than minGpa. */
  minGpa: number
  points: number
}

/** Legacy default: >3.9→30, each 0.1 band down one point to >1.5→6, >0→5. */
export const DEFAULT_GPA_TABLE: GpaTableBand[] = [
  { minGpa: 3.9, points: 30 },
  { minGpa: 3.8, points: 29 },
  { minGpa: 3.7, points: 28 },
  { minGpa: 3.6, points: 27 },
  { minGpa: 3.5, points: 26 },
  { minGpa: 3.4, points: 25 },
  { minGpa: 3.3, points: 24 },
  { minGpa: 3.2, points: 23 },
  { minGpa: 3.1, points: 22 },
  { minGpa: 3.0, points: 21 },
  { minGpa: 2.9, points: 20 },
  { minGpa: 2.8, points: 19 },
  { minGpa: 2.7, points: 18 },
  { minGpa: 2.6, points: 17 },
  { minGpa: 2.5, points: 16 },
  { minGpa: 2.4, points: 15 },
  { minGpa: 2.3, points: 14 },
  { minGpa: 2.2, points: 13 },
  { minGpa: 2.1, points: 12 },
  { minGpa: 2.0, points: 11 },
  { minGpa: 1.9, points: 10 },
  { minGpa: 1.8, points: 9 },
  { minGpa: 1.7, points: 8 },
  { minGpa: 1.6, points: 7 },
  { minGpa: 1.5, points: 6 },
  { minGpa: 0, points: 5 }
]

export function gpaTablePoints(gpa: number | null | undefined, table: GpaTableBand[] = DEFAULT_GPA_TABLE): number {
  if (gpa == null || !Number.isFinite(gpa) || gpa < 0) return 0
  if (gpa === 0) return 0
  const band = [...table].sort((a, b) => b.minGpa - a.minGpa).find(entry => gpa > entry.minGpa)
  return band?.points ?? 0
}

export function computeGpaScore(
  gpa: number | null | undefined,
  multiplier: number | null | undefined,
  bonus: number | null | undefined,
  table: GpaTableBand[] = DEFAULT_GPA_TABLE
): number {
  const points = gpaTablePoints(gpa, table)
  if (!points) return 0
  return points * (multiplier ?? 0) + (bonus ?? 0)
}

// ---------------------------------------------------------------------------
// Multiplier derivation
//
// Legacy `compile_gpa` cascade:
//   1 when a real cumulative GPA exists (recording, Opt-In, or DPSCD >= 6
//   quarters); otherwise the Partial GPA "Semesters" option text maps to
//   0.8/0.6/0.4/0.2/0; otherwise DPSCD "Quarters Available" 5→0.8, 4→0.6,
//   2-3→0.4, 1→0.2, else 0.
// ---------------------------------------------------------------------------

export interface MultiplierMap {
  /** Normalized "Semesters" option label → multiplier. */
  semesters?: Record<string, number>
  /** Quarter count (as string key) or range key → multiplier. */
  quarters?: Record<string, number>
}

/** Legacy default option-text → multiplier map (labels normalized). */
export const DEFAULT_SEMESTERS_MAP: Record<string, number> = {
  'more than 1 year (5 quarters, 4 trimesters)': 0.8,
  'one year (or 2 semesters or 3 trimesters)': 0.6,
  'one semester (or 2-3 quarters)': 0.4,
  'one quarter': 0.2,
  'none - progress report or gpa could not be calculated': 0
}

export const DEFAULT_QUARTERS_MAP: Record<string, number> = {
  '5': 0.8,
  '4': 0.6,
  '2-3': 0.4,
  '1': 0.2
}

export function normalizeOptionLabel(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/[()]/g, '').replace(/\s+/g, ' ').trim()
}

function quartersMultiplier(quarters: number | null | undefined, map: Record<string, number>): number {
  if (quarters == null || !Number.isFinite(quarters)) return 0
  const exact = map[String(quarters)]
  if (typeof exact === 'number') return exact
  for (const [key, value] of Object.entries(map)) {
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(key.trim())
    if (range && quarters >= Number(range[1]) && quarters <= Number(range[2])) return value
  }
  return 0
}

export interface GpaMultiplierInput {
  /** Source of the resolved cumulative GPA (recording | dpscd | optIn | partial | null). */
  resolvedSource?: string | null
  /** Whether a cumulative GPA value was actually resolved. */
  hasResolvedGpa: boolean
  /** Partial GPA review "Semesters" / "how much information" answer text. */
  semesters?: unknown
  /** DPSCD "Quarters Available" count. */
  quartersAvailable?: number | null
}

export function deriveGpaMultiplier(input: GpaMultiplierInput, map: MultiplierMap = {}): number {
  if (input.resolvedSource === 'recording' && input.hasResolvedGpa) return 1
  if (input.resolvedSource === 'optIn' && input.hasResolvedGpa) return 1
  const quarters = input.quartersAvailable
  if (input.resolvedSource === 'dpscd' && typeof quarters === 'number' && quarters >= 6) return 1

  const semestersMap = Object.fromEntries(
    Object.entries({ ...DEFAULT_SEMESTERS_MAP, ...(map.semesters || {}) })
      .map(([key, value]) => [normalizeOptionLabel(key), value])
  )
  const semestersKey = normalizeOptionLabel(input.semesters)
  if (semestersKey && Object.hasOwn(semestersMap, semestersKey)) {
    return semestersMap[semestersKey] ?? 0
  }

  const quartersMap = { ...DEFAULT_QUARTERS_MAP, ...(map.quarters || {}) }
  return quartersMultiplier(quarters, quartersMap)
}

// ---------------------------------------------------------------------------
// GPA Bonus Eligible label
// ---------------------------------------------------------------------------

export async function resolveGpaBonusLabelId(): Promise<string | undefined> {
  const label = await MetadataModel.findOne({
    type: 'label',
    name: { $regex: /^\s*gpa\s*bonus(\s*eligible)?\s*$/i }
  }).select('externalId name').lean()
  return label?.externalId
}
