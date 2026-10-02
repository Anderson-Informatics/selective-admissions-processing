import { describe, expect, it, vi } from 'vitest'
import { SUBMITTABLE_REQUEST_INTERVAL_MS, waitForSubmittableRequestSlot, type SubmittableRequestSlotStore } from './submittableRateLimit'

function createSlotStore() {
  let nextSlotAt = Date.now()
  let pending = Promise.resolve()
  const slots: number[] = []
  const store: SubmittableRequestSlotStore = {
    reserveSlot(intervalMs) {
      const reservation = pending.then(() => {
        const slotAt = nextSlotAt
        nextSlotAt = slotAt + intervalMs
        slots.push(slotAt)
        return slotAt
      })
      pending = reservation.then(() => undefined)
      return reservation
    }
  }
  return { store, slots }
}

describe('Submittable request pacing', () => {
  it('spaces concurrent reservations at 15 requests per second', async () => {
    const { store, slots } = createSlotStore()
    const sleep = vi.fn(async () => {})

    await Promise.all(Array.from({ length: 20 }, () => waitForSubmittableRequestSlot(store, sleep)))

    expect(slots).toHaveLength(20)
    expect(slots.slice(1).every((slot, index) => slot - slots[index]! === SUBMITTABLE_REQUEST_INTERVAL_MS)).toBe(true)
    expect(sleep).toHaveBeenCalledTimes(19)
  })
})
