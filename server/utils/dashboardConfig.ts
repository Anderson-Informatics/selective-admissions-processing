import { z } from 'zod'

export const dashboardMetricSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('reviewStage'), stageId: z.string().min(1) }).strict(),
  z.object({ type: z.literal('gpaStatus'), status: z.string().min(1) }).strict(),
  z.object({ type: z.literal('gpaRecord'), source: z.enum(['dpscd', 'optIn']) }).strict(),
  z.object({ type: z.literal('hsptLinked') }).strict(),
  z.object({
    type: z.literal('mappedField'),
    field: z.string().min(1),
    op: z.enum(['eq', 'ne', 'in', 'nin', 'isNull', 'notNull']).optional(),
    value: z.unknown().optional()
  }).strict()
])

export type DashboardMetricSpec = z.infer<typeof dashboardMetricSchema>

export const dashboardSegmentSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  metric: dashboardMetricSchema
}).strict()

export const dashboardHighlightSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  metric: dashboardMetricSchema,
  segments: z.array(dashboardSegmentSchema).optional()
}).strict()

export const dashboardConfigSchema = z.object({
  highlights: z.array(dashboardHighlightSchema).default([])
}).strict()

export type DashboardSegment = z.infer<typeof dashboardSegmentSchema>
export type DashboardHighlight = z.infer<typeof dashboardHighlightSchema>
export type DashboardConfig = z.infer<typeof dashboardConfigSchema>

interface HighlightSourceApplication {
  type?: string
  dashboard?: DashboardConfig | null
}

interface HighlightSourceStage {
  stageId: string
  name: string
  role?: string
}

function findStage(stages: HighlightSourceStage[], pattern: RegExp): HighlightSourceStage | undefined {
  return stages.find(stage => pattern.test(stage.name))
}

export function defaultDashboardHighlights(
  application: HighlightSourceApplication,
  stages: HighlightSourceStage[]
): DashboardHighlight[] {
  const highlights: DashboardHighlight[] = []
  const gpaStages = stages.filter(stage => /gpa/i.test(stage.name))
  const recordingStage = findStage(gpaStages, /recording/i) || findStage(gpaStages, /record/i)

  if (gpaStages.length || application.type === 'exam') {
    const segments: DashboardSegment[] = []
    if (recordingStage) {
      segments.push({ key: 'gpa-recording', label: recordingStage.name, metric: { type: 'reviewStage', stageId: recordingStage.stageId } })
    }
    segments.push({ key: 'dpscd-gpa', label: 'DPSCD GPA', metric: { type: 'gpaRecord', source: 'dpscd' } })
    segments.push({ key: 'optin-gpa', label: 'Opt-In GPA', metric: { type: 'gpaRecord', source: 'optIn' } })
    highlights.push({
      key: 'gpa',
      label: 'GPA Completion',
      metric: { type: 'gpaStatus', status: 'Complete' },
      segments
    })
  }

  const essayStage = findStage(stages, /essay/i)
  if (essayStage) {
    highlights.push({
      key: 'essay',
      label: 'Essay Review',
      metric: { type: 'reviewStage', stageId: essayStage.stageId }
    })
  }

  if (application.type === 'exam') {
    highlights.push({
      key: 'hspt',
      label: 'HSPT Completion',
      metric: { type: 'hsptLinked' }
    })
  }

  return highlights
}

export function resolveDashboardHighlights(
  application: HighlightSourceApplication,
  stages: HighlightSourceStage[]
): DashboardHighlight[] {
  const configured = application.dashboard?.highlights
  if (Array.isArray(configured) && configured.length) return configured
  return defaultDashboardHighlights(application, stages)
}
