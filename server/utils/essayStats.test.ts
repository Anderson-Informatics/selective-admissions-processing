import { describe, expect, it } from 'vitest'
import { buildEssayStats, detroitDayBounds, isCompletedReview, reviewerKey } from './essayStats'

// 2026-01-15T14:00:00Z = 09:00 in Detroit (EST, UTC-5)
const NOW = new Date('2026-01-15T19:00:00Z') // 14:00 Detroit

function at(detroitTime: string) {
  // detroitTime like '09:05' on the test day (EST → UTC-5)
  const [hours, minutes] = detroitTime.split(':').map(Number)
  return new Date(Date.UTC(2026, 0, 15, hours! + 5, minutes))
}

describe('detroitDayBounds', () => {
  it('returns the Detroit day containing the given instant', () => {
    const { start, end, dayKey } = detroitDayBounds(NOW)
    expect(dayKey).toBe('2026-01-15')
    expect(start.toISOString()).toBe('2026-01-15T05:00:00.000Z')
    expect(end.toISOString()).toBe('2026-01-16T05:00:00.000Z')
  })

  it('attributes late-night UTC instants to the correct Detroit day', () => {
    // 2026-01-16T03:00:00Z is 22:00 on Jan 15 in Detroit
    const { dayKey } = detroitDayBounds(new Date('2026-01-16T03:00:00Z'))
    expect(dayKey).toBe('2026-01-15')
  })
})

describe('isCompletedReview / reviewerKey', () => {
  it('treats completedAt or a complete status as completed', () => {
    expect(isCompletedReview({ completedAt: new Date() })).toBe(true)
    expect(isCompletedReview({ status: 'complete' })).toBe(true)
    expect(isCompletedReview({ status: 'Completed' })).toBe(true)
    expect(isCompletedReview({ status: 'in_progress' })).toBe(false)
    expect(isCompletedReview({})).toBe(false)
  })

  it('falls back through reviewer identifiers', () => {
    expect(reviewerKey({ reviewerId: 'u1', createdBy: 'a@b.com' })).toBe('u1')
    expect(reviewerKey({ createdBy: 'a@b.com' })).toBe('a@b.com')
    expect(reviewerKey({})).toBe('unknown')
  })
})

describe('buildEssayStats', () => {
  const names = new Map([['u1', 'Alice'], ['u2', 'Bob']])

  it('aggregates daily counts, scores, and reviewers', () => {
    const stats = buildEssayStats([
      { reviewerId: 'u1', score: 10, completedAt: at('09:05') },
      { reviewerId: 'u1', score: 14, completedAt: at('09:20') },
      { reviewerId: 'u2', score: 8, completedAt: at('09:50') },
      { reviewerId: 'u2', completedAt: new Date('2026-01-14T18:00:00Z') } // prior Detroit day
    ], { now: NOW, reviewerNames: names })

    expect(stats.daily.completed).toBe(3)
    expect(stats.daily.activeReviewers).toBe(2)
    expect(stats.daily.avgScore).toBeCloseTo(32 / 3, 2)
    expect(stats.daily.avgPerReviewer).toBe(1.5)
    expect(stats.overallCompleted).toBe(4)
    expect(stats.reviewers).toHaveLength(2)
    expect(stats.reviewers[0]).toMatchObject({ name: 'Alice', completed: 2, minScore: 10, maxScore: 14, avgScore: 12 })
    expect(stats.reviewers[1]).toMatchObject({ name: 'Bob', completed: 1, minScore: 8, maxScore: 8 })
  })

  it('builds 15-minute buckets from first to last review', () => {
    const stats = buildEssayStats([
      { reviewerId: 'u1', completedAt: at('09:05') },
      { reviewerId: 'u1', completedAt: at('09:14') },
      { reviewerId: 'u1', completedAt: at('09:44') }
    ], { now: NOW })

    expect(stats.buckets).toEqual([
      { time: '09:00', count: 2 },
      { time: '09:15', count: 0 },
      { time: '09:30', count: 1 }
    ])
  })

  it('computes per-hour rates with a minimum span', () => {
    const stats = buildEssayStats([
      { reviewerId: 'u1', completedAt: at('09:00') },
      { reviewerId: 'u1', completedAt: at('09:10') } // 10-minute span → 0.25h floor
    ], { now: NOW })
    expect(stats.reviewers[0]!.perHour).toBe(8) // 2 / 0.25

    const single = buildEssayStats([
      { reviewerId: 'u2', completedAt: at('10:00') }
    ], { now: NOW })
    expect(single.reviewers[0]!.perHour).toBe(1) // single review → 1h denominator
  })

  it('sums daily review windows instead of counting overnight gaps', () => {
    const stats = buildEssayStats([
      { reviewerId: 'u1', completedAt: new Date('2026-01-14T14:00:00Z') },
      { reviewerId: 'u1', completedAt: new Date('2026-01-14T16:00:00Z') },
      { reviewerId: 'u1', completedAt: at('09:00') },
      { reviewerId: 'u1', completedAt: at('12:00') }
    ], { now: NOW, includeOverall: true })
    expect(stats.overallReviewers?.[0]?.perHour).toBe(0.8)
    expect(stats.reviewers[0]?.perHour).toBe(0.67)
  })

  it('applies minimum spans and single or identical timestamp fallbacks per day', () => {
    const stats = buildEssayStats([
      { reviewerId: 'u1', completedAt: new Date('2026-01-13T14:00:00Z') },
      { reviewerId: 'u1', completedAt: new Date('2026-01-13T14:10:00Z') },
      { reviewerId: 'u1', completedAt: new Date('2026-01-14T14:00:00Z') },
      { reviewerId: 'u1', completedAt: at('09:00') },
      { reviewerId: 'u1', completedAt: at('09:00') }
    ], { now: NOW, includeOverall: true })
    expect(stats.overallReviewers?.[0]?.perHour).toBe(2.22)
    expect(stats.reviewers[0]?.perHour).toBe(2)
  })

  it('groups by Detroit dates across UTC midnight and falls back to createdAt', () => {
    const stats = buildEssayStats([
      { reviewerId: 'u1', completedAt: new Date('2026-01-15T23:00:00Z') },
      { reviewerId: 'u1', completedAt: new Date('2026-01-16T01:00:00Z') },
      { reviewerId: 'u1', status: 'complete', createdAt: new Date('2026-01-16T06:00:00Z') },
      { reviewerId: 'u1', status: 'complete', createdAt: new Date('2026-01-16T07:00:00Z') }
    ], { now: NOW, includeOverall: true })
    expect(stats.overallReviewers?.[0]?.perHour).toBe(1.33)
  })

  it('includes overall stats when requested', () => {
    const stats = buildEssayStats([
      { reviewerId: 'u1', score: 10, completedAt: at('09:00') },
      { reviewerId: 'u2', score: 6, completedAt: new Date('2026-01-10T18:00:00Z') }
    ], { now: NOW, includeOverall: true, statusCounts: [{ status: 'Needs Two Reviews', count: 3 }] })

    expect(stats.overall?.completed).toBe(2)
    expect(stats.overall?.avgScore).toBe(8)
    expect(stats.overallReviewers).toHaveLength(2)
    expect(stats.statusCounts).toEqual([{ status: 'Needs Two Reviews', count: 3 }])
  })

  it('returns empty buckets and null scores when nothing was reviewed today', () => {
    const stats = buildEssayStats([], { now: NOW })
    expect(stats.buckets).toEqual([])
    expect(stats.daily.avgScore).toBeNull()
    expect(stats.reviewers).toEqual([])
  })
})
