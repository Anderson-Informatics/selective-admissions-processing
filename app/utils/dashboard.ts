export interface HighlightSegment {
  key: string
  label: string
  completed: number
  total: number
  percent: number | null
}

export interface DashboardHighlightResult extends HighlightSegment {
  segments: HighlightSegment[]
}

export interface ApplicationStageStat {
  stageId: string
  name: string
  order: number
  role: string
  required: number
  completed: number
  percent: number | null
}

export interface ApplicationDashboard {
  applicationId: string
  name: string
  type: string
  total: number
  highlights: DashboardHighlightResult[]
  stages: ApplicationStageStat[]
}
