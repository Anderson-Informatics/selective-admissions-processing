import * as XLSX from 'xlsx'
import type { EssayBucket, EssayStats, EssaySummary, ReviewerStat } from './essayStats'

export interface EssayExportFile {
  name: string
  base64: string
}

interface ExportInput {
  title: string
  applicationName: string
  stats: EssayStats
  movedSubmissions?: Array<Record<string, unknown>>
}

function summaryRows(title: string, summary: EssaySummary, overallCompleted?: number): (string | number | null)[][] {
  const rows: (string | number | null)[][] = [
    [title],
    ['Metric', 'Value'],
    ['Reviews completed', summary.completed]
  ]
  if (overallCompleted != null) rows.push(['Reviews completed overall', overallCompleted])
  rows.push(
    ['Average score', summary.avgScore],
    ['Active reviewers', summary.activeReviewers],
    ['Average reviews per reviewer', summary.avgPerReviewer]
  )
  return rows
}

function reviewerRows(title: string, reviewers: ReviewerStat[]): (string | number | null)[][] {
  return [
    [title],
    ['Reviewer', 'Completed', 'Per hour', 'Min score', 'Max score', 'Avg score'],
    ...reviewers.map(reviewer => [
      reviewer.name,
      reviewer.completed,
      reviewer.perHour,
      reviewer.minScore,
      reviewer.maxScore,
      reviewer.avgScore
    ])
  ]
}

function bucketRows(buckets: EssayBucket[]): (string | number)[][] {
  const max = Math.max(1, ...buckets.map(bucket => bucket.count))
  return [
    ['Time (Detroit)', 'Reviews', ''],
    ...buckets.map(bucket => [bucket.time, bucket.count, '█'.repeat(Math.round((bucket.count / max) * 40))])
  ]
}

function statusCountRows(statusCounts: { status: string, count: number }[]): (string | number)[][] {
  return [
    ['Essay review status', 'Submissions'],
    ...statusCounts.map(row => [row.status, row.count])
  ]
}

function appendGrid(workbook: XLSX.WorkBook, name: string, rows: (string | number | null)[][]) {
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name.slice(0, 31))
}

export function buildEssayExport(input: ExportInput): EssayExportFile {
  const workbook = XLSX.utils.book_new()

  appendGrid(workbook, 'Daily Summary', [
    [input.title],
    ['Application', input.applicationName],
    ['Day (America/Detroit)', input.stats.day],
    [],
    ...summaryRows('Daily summary', input.stats.daily, input.stats.overallCompleted)
  ])
  appendGrid(workbook, 'Reviewers (Today)', reviewerRows(`Reviewer stats — ${input.stats.day}`, input.stats.reviewers))
  appendGrid(workbook, '15-Min Buckets', [
    ['Reviews completed per 15-minute interval', input.stats.day],
    [],
    ...bucketRows(input.stats.buckets)
  ])

  if (input.stats.statusCounts?.length) {
    appendGrid(workbook, 'Essay Status Counts', statusCountRows(input.stats.statusCounts))
  }
  if (input.stats.overall) {
    appendGrid(workbook, 'Overall Summary', summaryRows('Overall summary (all days)', input.stats.overall))
    appendGrid(workbook, 'Reviewers (Overall)', reviewerRows('Reviewer stats — all days', input.stats.overallReviewers || []))
  }
  if (input.movedSubmissions?.length) {
    appendGrid(workbook, 'Routing Moves', [
      ['Submission', 'Applicant', 'Application', 'From stage', 'To stage', 'Reason', 'Backward'],
      ...input.movedSubmissions.map(move => [
        String(move.submissionId || ''),
        String(move.applicantName || ''),
        String(move.applicationName || ''),
        String(move.fromStage || ''),
        String(move.toStage || ''),
        String(move.reason || ''),
        move.backward ? 'yes' : 'no'
      ])
    ])
  }

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  const stamp = new Date().toISOString().slice(0, 10)
  return {
    name: `essay-scoring-${stamp}.xlsx`,
    base64: buffer.toString('base64')
  }
}
