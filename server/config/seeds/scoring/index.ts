import ehs9 from './ehs-9th-grade.json'
import ehsCurrentHs from './ehs-current-hs.json'

export const scoringSeeds = {
  'ehs-9th-grade': ehs9,
  'ehs-current-hs': ehsCurrentHs
} as const

export type ScoringSeedKey = keyof typeof scoringSeeds
