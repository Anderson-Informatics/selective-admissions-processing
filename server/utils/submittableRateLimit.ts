import mongoose from 'mongoose'

export const SUBMITTABLE_REQUEST_INTERVAL_MS = Math.ceil(1000 / 15)

export interface SubmittableRequestSlotStore {
  reserveSlot: (intervalMs: number) => Promise<number>
}

interface RateLimitDocument extends Record<string, unknown> {
  _id: string
  nextSlotAt?: Date
  reservedSlotAt?: Date
}

async function reserveMongoSlot(intervalMs: number): Promise<number> {
  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is required to pace Submittable API requests')

  const collection = db.collection<RateLimitDocument>('submittable_request_limits')
  const slotExpression = { $max: [{ $ifNull: ['$nextSlotAt', '$$NOW'] }, '$$NOW'] }
  const update = [{
    $set: {
      reservedSlotAt: slotExpression,
      nextSlotAt: { $add: [slotExpression, intervalMs] }
    }
  }]
  let upsert = true

  while (true) {
    try {
      const result = await collection.findOneAndUpdate(
        { _id: 'global' },
        update,
        { upsert, returnDocument: 'after' }
      ) as unknown as RateLimitDocument | { value?: RateLimitDocument, reservedSlotAt?: Date } | null
      const reservation = (result && 'value' in result ? result.value : result) as RateLimitDocument | null | undefined
      if (!(reservation?.reservedSlotAt instanceof Date)) throw new Error('Failed to reserve a Submittable API request slot')
      return reservation.reservedSlotAt.getTime()
    } catch (error) {
      if (upsert && (error as { code?: number }).code === 11000) {
        upsert = false
        continue
      }
      throw error
    }
  }
}

const mongoSlotStore: SubmittableRequestSlotStore = { reserveSlot: reserveMongoSlot }

export async function waitForSubmittableRequestSlot(
  store: SubmittableRequestSlotStore = mongoSlotStore,
  sleep: (milliseconds: number) => Promise<void> = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
): Promise<void> {
  const slotAt = await store.reserveSlot(SUBMITTABLE_REQUEST_INTERVAL_MS)
  const delay = slotAt - Date.now()
  if (delay > 0) await sleep(delay)
}
