export const DETROIT_TZ = 'America/Detroit'

export interface EssayReviewInput {
  reviewerId?: string
  createdBy?: string
  score?: number
  status?: string
  completedAt?: Date | string
  createdAt?: Date | string
}

export interface ReviewerStat {
  reviewerId: string
  name: string
  completed: number
  perHour: number
  minScore: number | null
  maxScore: number | null
  avgScore: number | null
}

export interface EssayBucket {
  time: string
  count: number
}

export interface EssaySummary {
  completed: number
  avgScore: number | null
  activeReviewers: number
  avgPerReviewer: number
}

export interface EssayStats {
  day: string
  daily: EssaySummary
  overallCompleted: number
  buckets: EssayBucket[]
  reviewers: ReviewerStat[]
  overall?: EssaySummary
  overallReviewers?: ReviewerStat[]
  statusCounts?: { status: string, count: number }[]
}

const BUCKET_MS = 15 * 60 * 1000

export function isCompletedReview(review: EssayReviewInput): boolean {
  const status = review.status?.trim().toLowerCase()
  return Boolean(review.completedAt) || status === 'complete' || status === 'completed'
}

export function reviewerKey(review: EssayReviewInput): string {
  return review.reviewerId || review.createdBy || 'unknown'
}

export function detroitDayBounds(now: Date = new Date()): { start: Date, end: Date, dayKey: string } {
  const dayKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: DETROIT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now)
  const [year, month, day] = dayKey.split('-').map(Number)
  const tzName = new Intl.DateTimeFormat('en-US', {
    timeZone: DETROIT_TZ,
    timeZoneName: 'longOffset'
  }).formatToParts(now).find(part => part.type === 'timeZoneName')?.value || 'GMT-05:00'
  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(tzName)
  const offsetMinutes = match
    ? (Number(match[2]) * 60 + Number(match[3] || 0)) * (match[1] === '-' ? -1 : 1)
    : -300
  const start = new Date(Date.UTC(year!, month! - 1, day!) - offsetMinutes * 60_000)
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000), dayKey }
}

function detroitTimeLabel(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: DETROIT_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date)
}

function summarize(reviews: EssayReviewInput[], reviewerNames: Map<string, string>): { summary: EssaySummary, reviewers: ReviewerStat[] } {
  const scores = reviews.map(review => review.score).filter((score): score is number => typeof score === 'number')
  const byReviewer = new Map<string, EssayReviewInput[]>()
  for (const review of reviews) {
    const key = reviewerKey(review)
    const list = byReviewer.get(key) || []
    list.push(review)
    byReviewer.set(key, list)
  }
  const dayFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: DETROIT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
  const reviewers: ReviewerStat[] = [...byReviewer.entries()].map(([id, list]) => {
    const dailyWindows = new Map<string, { first: number, last: number }>()
    for (const review of list) {
      const time = new Date(review.completedAt || review.createdAt || 0).getTime()
      if (!(time > 0)) continue
      const day = dayFormatter.format(time)
      const window = dailyWindows.get(day)
      dailyWindows.set(day, { first: Math.min(window?.first ?? time, time), last: Math.max(window?.last ?? time, time) })
    }
    const hours = [...dailyWindows.values()].reduce((total, { first, last }) => {
      const spanMs = last - first
      return total + (spanMs > 0 ? Math.max(spanMs / 3_600_000, 0.25) : 1)
    }, 0) || 1
    const reviewerScores = list.map(review => review.score).filter((score): score is number => typeof score === 'number')
    return {
      reviewerId: id,
      name: reviewerNames.get(id) || id,
      completed: list.length,
      perHour: Math.round((list.length / hours) * 100) / 100,
      minScore: reviewerScores.length ? Math.min(...reviewerScores) : null,
      maxScore: reviewerScores.length ? Math.max(...reviewerScores) : null,
      avgScore: reviewerScores.length ? Math.round((reviewerScores.reduce((sum, score) => sum + score, 0) / reviewerScores.length) * 100) / 100 : null
    }
  }).sort((a, b) => b.completed - a.completed || a.name.localeCompare(b.name))
  return {
    summary: {
      completed: reviews.length,
      avgScore: scores.length ? Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 100) / 100 : null,
      activeReviewers: byReviewer.size,
      avgPerReviewer: byReviewer.size ? Math.round((reviews.length / byReviewer.size) * 100) / 100 : 0
    },
    reviewers
  }
}

export function buildEssayStats(
  reviews: EssayReviewInput[],
  options: {
    now?: Date
    reviewerNames?: Map<string, string>
    includeOverall?: boolean
    statusCounts?: { status: string, count: number }[]
  } = {}
): EssayStats {
  const { start, end, dayKey } = detroitDayBounds(options.now || new Date())
  const completed = reviews.filter(isCompletedReview)
  const today = completed.filter((review) => {
    const time = new Date(review.completedAt || review.createdAt || 0).getTime()
    return time >= start.getTime() && time < end.getTime()
  }).sort((a, b) => new Date(a.completedAt || a.createdAt || 0).getTime() - new Date(b.completedAt || b.createdAt || 0).getTime())

  const buckets: EssayBucket[] = []
  if (today.length) {
    const first = new Date(today[0]!.completedAt || today[0]!.createdAt || 0).getTime()
    const last = new Date(today[today.length - 1]!.completedAt || today[today.length - 1]!.createdAt || 0).getTime()
    const firstBucket = Math.floor((first - start.getTime()) / BUCKET_MS)
    const lastBucket = Math.floor((last - start.getTime()) / BUCKET_MS)
    const counts = new Map<number, number>()
    for (const review of today) {
      const index = Math.floor((new Date(review.completedAt || review.createdAt || 0).getTime() - start.getTime()) / BUCKET_MS)
      counts.set(index, (counts.get(index) || 0) + 1)
    }
    for (let index = firstBucket; index <= lastBucket; index += 1) {
      buckets.push({ time: detroitTimeLabel(new Date(start.getTime() + index * BUCKET_MS)), count: counts.get(index) || 0 })
    }
  }

  const names = options.reviewerNames || new Map<string, string>()
  const daily = summarize(today, names)
  const stats: EssayStats = {
    day: dayKey,
    daily: daily.summary,
    overallCompleted: completed.length,
    buckets,
    reviewers: daily.reviewers,
    statusCounts: options.statusCounts
  }
  if (options.includeOverall) {
    const overall = summarize(completed, names)
    stats.overall = overall.summary
    stats.overallReviewers = overall.reviewers
  }
  return stats
}
