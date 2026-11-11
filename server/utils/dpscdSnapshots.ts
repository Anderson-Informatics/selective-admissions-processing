import type { DpscdGpa } from '../models/GpaRecord'
import { resolveSubmissionRound, type CycleRoundInput } from './cycleRounds'

export function selectDpscdSnapshot(
  dpscd: DpscdGpa | undefined,
  submission: { completedAt?: Date | string },
  rounds: CycleRoundInput[]
): DpscdGpa | undefined {
  if (!dpscd?.snapshots) return dpscd
  const round = resolveSubmissionRound(submission, rounds)
  const configuredRound = rounds.find(item => item.key === round.key)
  const selectedSnapshot = configuredRound ? (configuredRound.order === 1 ? 'r1' : 'all') : undefined
  const snapshot = selectedSnapshot ? dpscd.snapshots[selectedSnapshot] : undefined
  const selectionIssue = !selectedSnapshot
    ? `Cannot select DPSCD snapshot: ${round.status}`
    : !snapshot
        ? `Missing DPSCD ${selectedSnapshot} snapshot`
        : snapshot.quartersAvailable == null || snapshot.cumulativeGpa == null ? `DPSCD ${selectedSnapshot} snapshot is missing GPA or quartersAvailable` : undefined
  return {
    ...dpscd,
    cumulativeGpa: snapshot?.cumulativeGpa,
    quartersAvailable: snapshot?.quartersAvailable,
    gpaStatus: snapshot?.gpaStatus,
    selectedSnapshot,
    selectedRound: round.key,
    selectionIssue
  }
}
