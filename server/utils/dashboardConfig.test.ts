import { describe, expect, it } from 'vitest'
import { dashboardConfigSchema, defaultDashboardHighlights, resolveDashboardHighlights } from './dashboardConfig'

const stages = [
  { stageId: 'new', name: 'New Application', role: 'initial' },
  { stageId: 'essay', name: 'Essay Scoring', role: 'work' },
  { stageId: 'gpa-completion', name: 'GPA Completion', role: 'work' },
  { stageId: 'gpa-recording', name: 'GPA Recording', role: 'work' },
  { stageId: 'gpa-pending', name: 'GPA Pending - DPSCD and Opt-In Schools', role: 'hold' },
  { stageId: 'accepted', name: 'CT Accepted', role: 'final' }
]

describe('defaultDashboardHighlights', () => {
  it('builds gpa, essay, and hspt highlights for an exam application', () => {
    const highlights = defaultDashboardHighlights({ type: 'exam' }, stages)

    expect(highlights.map(highlight => highlight.key)).toEqual(['gpa', 'essay', 'hspt'])

    const gpa = highlights[0]!
    expect(gpa.metric).toEqual({ type: 'gpaStatus', status: 'Complete' })
    expect(gpa.segments).toEqual([
      { key: 'gpa-recording', label: 'GPA Recording', metric: { type: 'reviewStage', stageId: 'gpa-recording' } },
      { key: 'dpscd-gpa', label: 'DPSCD GPA', metric: { type: 'gpaRecord', source: 'dpscd' } },
      { key: 'optin-gpa', label: 'Opt-In GPA', metric: { type: 'gpaRecord', source: 'optIn' } }
    ])

    expect(highlights[1]!.metric).toEqual({ type: 'reviewStage', stageId: 'essay' })
    expect(highlights[2]!.metric).toEqual({ type: 'hsptLinked' })
  })

  it('omits hspt for non-exam applications', () => {
    const highlights = defaultDashboardHighlights({ type: 'application' }, stages)
    expect(highlights.map(highlight => highlight.key)).toEqual(['gpa', 'essay'])
  })

  it('omits gpa when no gpa stages exist and the application is not an exam', () => {
    const highlights = defaultDashboardHighlights({ type: 'application' }, [
      { stageId: 'essay', name: 'Essay Scoring', role: 'work' }
    ])
    expect(highlights.map(highlight => highlight.key)).toEqual(['essay'])
  })

  it('returns no highlights for an application with no matching stages', () => {
    const highlights = defaultDashboardHighlights({ type: 'dsa' }, [
      { stageId: 'interview', name: 'Interview', role: 'work' }
    ])
    expect(highlights).toEqual([])
  })

  it('skips the recording segment when no recording stage exists', () => {
    const highlights = defaultDashboardHighlights({ type: 'exam' }, [
      { stageId: 'essay', name: 'Essay Scoring', role: 'work' }
    ])
    const gpa = highlights.find(highlight => highlight.key === 'gpa')!
    expect(gpa.segments!.map(segment => segment.key)).toEqual(['dpscd-gpa', 'optin-gpa'])
  })
})

describe('resolveDashboardHighlights', () => {
  it('prefers configured highlights over defaults', () => {
    const configured = {
      highlights: [{ key: 'custom', label: 'Custom', metric: { type: 'hsptLinked' as const } }]
    }
    const highlights = resolveDashboardHighlights({ type: 'exam', dashboard: configured }, stages)
    expect(highlights).toEqual(configured.highlights)
  })

  it('falls back to defaults when highlights are empty', () => {
    const highlights = resolveDashboardHighlights({ type: 'exam', dashboard: { highlights: [] } }, stages)
    expect(highlights.map(highlight => highlight.key)).toEqual(['gpa', 'essay', 'hspt'])
  })
})

describe('dashboardConfigSchema', () => {
  it('accepts a valid config', () => {
    const result = dashboardConfigSchema.safeParse({
      highlights: [{
        key: 'gpa',
        label: 'GPA Completion',
        metric: { type: 'gpaStatus', status: 'Complete' },
        segments: [{ key: 'dpscd', label: 'DPSCD GPA', metric: { type: 'gpaRecord', source: 'dpscd' } }]
      }]
    })
    expect(result.success).toBe(true)
  })

  it('rejects unknown metric types', () => {
    const result = dashboardConfigSchema.safeParse({
      highlights: [{ key: 'bad', label: 'Bad', metric: { type: 'nope' } }]
    })
    expect(result.success).toBe(false)
  })
})
