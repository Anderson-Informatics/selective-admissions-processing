export interface SubmittableReviewStage {
  reviewStageId: string
  stageName: string
  type: string
  formId?: string
  stageOrder?: number
}

export interface SubmittableProject {
  projectId: string
  name: string
  initialFormId?: string
  reviewStages: SubmittableReviewStage[]
}

export interface SubmittableFormField {
  formFieldId: string
  label: string
  fieldType: string
  isRequired?: boolean
  options?: { formOptionId: string, label: string }[]
}

export interface SubmittableForm {
  formId: string
  name: string
  fields: SubmittableFormField[]
}

export interface SubmittableFormListItem {
  formId: string
  name: string
}

export interface SubmittableLabel {
  labelId: string
  name: string
}

export interface SubmittableTeamMember {
  userId: string
  email: string
  firstName?: string
  lastName?: string
}

export interface SubmittableFormEntry {
  formType: string
  entry: {
    submissionId: string
    projectId?: string
    stageId?: string
    reviewerId?: string
    score?: number
    isAssigned?: boolean
    entryVersionId?: string
    entryId: string
    formId: string
    status: string
    completedAt?: string
    createdBy?: string
    createdAt?: string
    fieldData: unknown[]
  }
}

export interface SubmittableSubmissionListItem {
  submissionId: string
  projectId?: string
  reviewStageId?: string
  status?: string
  labels?: string[]
}

export interface SubmittableClientConfig {
  apiKey: string
  baseUrl?: string
  v3BaseUrl?: string
}

function getAuthHeader(apiKey?: string): string {
  const key = apiKey || useRuntimeConfig().submittableApiKey
  if (!key) {
    throw new Error('NUXT_SUBMITTABLE_API_KEY is not set')
  }

  if (key.startsWith('Basic ')) {
    return key
  }

  try {
    const decoded = atob(key)
    if (decoded.endsWith(':')) {
      return `Basic ${key}`
    }
  } catch {
    // fall through
  }

  return `Basic ${btoa(`${key}:`)}`
}

export async function submittableRequest<T>(path: string, options: RequestInit = {}, clientConfig?: SubmittableClientConfig): Promise<T> {
  const runtimeConfig = clientConfig ? undefined : useRuntimeConfig()
  const baseUrl = clientConfig?.baseUrl || runtimeConfig?.submittableBaseUrl || 'https://submittable-api.submittable.com/v4'
  const url = `${baseUrl}${path}`

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': getAuthHeader(clientConfig?.apiKey),
      ...options.headers
    }
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Submittable API error ${response.status}: ${response.statusText} ${text.slice(0, 200)}`)
  }

  return response.json() as Promise<T>
}

export async function fetchProjects(clientConfig?: SubmittableClientConfig): Promise<SubmittableProject[]> {
  const projects: SubmittableProject[] = []
  let continuationToken: string | undefined

  do {
    const params = new URLSearchParams()
    if (!continuationToken) {
      params.set('size', '50')
    } else {
      params.set('continuationToken', continuationToken)
    }

    const data = await submittableRequest<{ items: SubmittableProject[], continuationToken?: string }>(`/projects?${params.toString()}`, {}, clientConfig)
    projects.push(...(data.items || []))
    continuationToken = data.continuationToken
  } while (continuationToken)

  return projects
}

export async function fetchForm(formId: string, clientConfig?: SubmittableClientConfig): Promise<SubmittableForm> {
  const data = await submittableRequest<unknown>(`/forms/${formId}`, {}, clientConfig)
  const formData = data as { formId: string, name: string, fields: unknown[] }
  return {
    formId: formData.formId,
    name: formData.name,
    fields: (formData.fields || []).map((field: unknown) => {
      const f = field as { formFieldId: string, label: string, fieldType: string, isRequired?: boolean, options?: unknown[] }
      return {
        formFieldId: f.formFieldId,
        label: f.label,
        fieldType: f.fieldType,
        isRequired: f.isRequired,
        options: (f.options || []).map((option: unknown) => {
          const o = option as { formOptionId: string, label: string }
          return { formOptionId: o.formOptionId, label: o.label }
        })
      }
    })
  }
}

export async function fetchForms(clientConfig?: SubmittableClientConfig): Promise<SubmittableFormListItem[]> {
  const forms: SubmittableFormListItem[] = []
  let continuationToken: string | undefined

  do {
    const params = new URLSearchParams()
    if (!continuationToken) {
      params.set('size', '500')
    } else {
      params.set('continuationToken', continuationToken)
    }

    const data = await submittableRequest<{ items: SubmittableFormListItem[], continuationToken?: string }>(`/forms?${params.toString()}`, {}, clientConfig)
    forms.push(...(data.items || []))
    continuationToken = data.continuationToken
  } while (continuationToken)

  return forms
}

export async function fetchLabels(clientConfig?: SubmittableClientConfig): Promise<SubmittableLabel[]> {
  const labels: SubmittableLabel[] = []
  let continuationToken: string | undefined

  do {
    const params = new URLSearchParams()
    if (!continuationToken) {
      params.set('size', '500')
    } else {
      params.set('continuationToken', continuationToken)
    }

    const data = await submittableRequest<{ items: SubmittableLabel[], continuationToken?: string }>(`/labels?${params.toString()}`, {}, clientConfig)
    labels.push(...(data.items || []))
    continuationToken = data.continuationToken
  } while (continuationToken)

  return labels
}

export async function fetchTeam(clientConfig?: SubmittableClientConfig): Promise<SubmittableTeamMember[]> {
  const data = await submittableRequest<{ teamMembers: SubmittableTeamMember[] }>('/organizations/team', {}, clientConfig)
  return data.teamMembers || []
}

export async function fetchSubmission(
  submissionId: string,
  clientConfig?: SubmittableClientConfig
): Promise<SubmittableSubmissionListItem> {
  const data = await submittableRequest<unknown>(`/submissions/${submissionId}`, {}, clientConfig)
  const sub = data as { submissionId: string, projectId?: string, reviewStageId?: string, status?: string, submissionStatus?: string }
  return {
    submissionId: sub.submissionId,
    projectId: sub.projectId,
    reviewStageId: sub.reviewStageId,
    status: sub.status || sub.submissionStatus
  }
}

export async function fetchSubmissionsForProject(
  projectId: string,
  clientConfig?: SubmittableClientConfig
): Promise<SubmittableSubmissionListItem[]> {
  const submissions: SubmittableSubmissionListItem[] = []
  let continuationToken: string | undefined

  do {
    const params = new URLSearchParams()
    if (continuationToken) {
      params.set('continuationToken', continuationToken)
    } else {
      params.set('projectId', projectId)
      params.set('size', '500')
    }

    const data = await submittableRequest<{ items: unknown[], continuationToken?: string }>(`/submissions?${params.toString()}`, {}, clientConfig)
    submissions.push(...(data.items || []).map((item) => {
      const sub = item as SubmittableSubmissionListItem & { submissionStatus?: string }
      return { ...sub, status: sub.status || sub.submissionStatus }
    }))
    continuationToken = data.continuationToken
  } while (continuationToken)

  return submissions
}

export async function fetchEntriesForForm(
  formId: string,
  onBatch?: (items: SubmittableFormEntry[], page: number) => Promise<void> | void,
  clientConfig?: SubmittableClientConfig
): Promise<SubmittableFormEntry[]> {
  const entries: SubmittableFormEntry[] = []
  let continuationToken: string | undefined
  let page = 0

  do {
    const params = new URLSearchParams()
    if (!continuationToken) {
      params.set('size', '500')
    } else {
      params.set('continuationToken', continuationToken)
    }

    const data = await submittableRequest<{ items: SubmittableFormEntry[], continuationToken?: string }>(`/entries/forms/${formId}?${params.toString()}`, {}, clientConfig)
    const items = data.items || []
    page += 1

    if (onBatch) {
      await onBatch(items, page)
    } else {
      entries.push(...items)
    }

    continuationToken = data.continuationToken
  } while (continuationToken)

  return onBatch ? [] : entries
}

function extractV3SubmissionInt(item: Record<string, unknown>): number | undefined {
  for (const key of ['submissionIdInt', 'submission_id', 'id', 'submissionId']) {
    const value = item[key]
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
      return value
    }
  }
}

export async function convertSubmissionIdsToInts(
  submissionIdInts: number[],
  clientConfig?: SubmittableClientConfig
): Promise<Map<number, string>> {
  const idMap = new Map<number, string>()
  const batchSize = 500

  for (let i = 0; i < submissionIdInts.length; i += batchSize) {
    const batch = submissionIdInts.slice(i, i + batchSize)
    const data = await submittableRequest<Record<string, string>>(
      '/submissions/id/convert/ints',
      { method: 'POST', body: JSON.stringify(batch) },
      clientConfig
    )
    for (const [intStr, submissionId] of Object.entries(data || {})) {
      idMap.set(Number(intStr), submissionId)
    }
  }

  return idMap
}

export async function fetchV3SubmissionInts(
  projectIds: string[],
  clientConfig?: SubmittableClientConfig
): Promise<number[]> {
  const intIds: number[] = []
  const runtimeConfig = clientConfig ? undefined : useRuntimeConfig()
  const apiKey = clientConfig?.apiKey || runtimeConfig?.submittableApiKey
  if (!apiKey) throw new Error('NUXT_SUBMITTABLE_API_KEY is not set')
  const v3ClientConfig: SubmittableClientConfig = {
    apiKey,
    baseUrl: clientConfig?.v3BaseUrl || runtimeConfig?.submittableV3BaseUrl || 'https://submittable-api.submittable.com/v3'
  }

  const projectParams = projectIds.map(id => `Projects.Include=${encodeURIComponent(id)}`).join('&')
  const firstPage = await submittableRequest<{
    items: unknown[]
    totalPages?: number
    totalCount?: number
  }>(`/submissions?page=1&pageSize=100&${projectParams}`, {}, v3ClientConfig)

  const items = [...(firstPage.items || [])]
  const totalPages = firstPage.totalPages ?? (firstPage.totalCount ? Math.ceil(firstPage.totalCount / 100) : 1)

  for (let page = 2; page <= totalPages; page++) {
    const pageData = await submittableRequest<{ items: unknown[] }>(
      `/submissions?page=${page}&pageSize=100&${projectParams}`,
      {},
      v3ClientConfig
    )
    items.push(...(pageData.items || []))
  }

  for (const rawItem of items) {
    const intId = extractV3SubmissionInt(rawItem as Record<string, unknown>)
    if (intId != null) intIds.push(intId)
  }

  return intIds
}
