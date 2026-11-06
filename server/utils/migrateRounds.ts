import { ApplicationModel } from '../models/Application'
import { CycleModel } from '../models/Cycle'

interface LegacyCycleDoc {
  _id: unknown
  rounds?: Array<{ key: string, name: string, order: number, startDate: Date, endDate: Date, active: boolean }>
}

/**
 * One-time migration: copy legacy `Cycle.rounds` onto each application in that cycle
 * that doesn't already define rounds, then unset the cycle-level field. Idempotent —
 * safe to run on every boot.
 */
export async function migrateCycleRoundsToApplications() {
  const cycles = await CycleModel.collection.find({ rounds: { $exists: true, $ne: [] } }).toArray() as LegacyCycleDoc[]
  for (const cycle of cycles) {
    const result = await ApplicationModel.updateMany(
      { cycleId: String(cycle._id), $or: [{ rounds: { $exists: false } }, { rounds: { $size: 0 } }] },
      { $set: { rounds: cycle.rounds } }
    )
    await CycleModel.updateOne({ _id: cycle._id }, { $unset: { rounds: 1 } })
    if (result.modifiedCount) {
      console.log(`Migrated ${cycle.rounds?.length || 0} rounds from cycle ${cycle._id} to ${result.modifiedCount} applications`)
    }
  }
}
