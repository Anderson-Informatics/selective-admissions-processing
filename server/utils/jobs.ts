import type { AnyBulkWriteOperation, HydratedDocument } from 'mongoose'
import { JobModel, type Job, type JobProgress, type JobStatus, type JobType } from '../models/Job'
import { ApplicationModel } from '../models/Application'
import { MetadataModel, type Metadata } from '../models/Metadata'
import { HSPTUploadModel } from '../models/HSPTUpload'
import { extractFormSubmissions } from './extraction'
import { parseAndUpsertHSPTCsv, previewHSPTCsv, previewHSPTMatching, runHSPTMatching } from './hspt'
import { mapWithConcurrency } from './concurrency'
import { getApplicationIdsWithMappings, getMappedFormManifest } from './mappingStatus'
import { mapFormResponsesForCycle } from './responseMapping'
import { runValidationForCycle } from './validation'
import { reconcileValidationLabelsForCycle } from './validationLabels'
import { runCatchmentForCycle } from './catchment'
import { commitOptInGpaUpload, importDpscdGpaRecords, previewOptInGpaUpload } from './gpa'
import { syncGpaStatusLabels } from './gpaStatusLabels'
import { clearWithdrawnStatusLabels } from './withdrawnStatusLabels'
import { fetchForm, fetchForms, fetchLabels, fetchProjects, fetchTeam, type SubmittableClientConfig } from './submittable'
import { refreshReviewCompletion } from './reviewCompletionRefresh'

export const JOB_TYPES: { value: JobType, label: string }[] = [
  { value: 'metadata_sync', label: 'Metadata sync' },
  { value: 'submission_extraction', label: 'Submission extraction' },
  { value: 'form_response_mapping', label: 'Form response mapping' },
  { value: 'catchment_lookup', label: 'Catchment lookup' },
  { value: 'run_validation', label: 'Run validation' },
  { value: 'refresh_review_completion', label: 'Refresh review completion' },
  { value: 'gpa_status_label_sync', label: 'GPA status label sync' },
  { value: 'dpscd_gpa_import', label: 'DPSCD GPA import' },
  { value: 'optin_gpa_preview', label: 'Opt-In GPA preview' },
  { value: 'optin_gpa_commit', label: 'Opt-In GPA commit' },
  { value: 'run_routing', label: 'Run routing' },
  { value: 'score_compilation', label: 'Score compilation' },
  { value: 'essay_begin_scoring', label: 'Essay — Begin Scoring' },
  { value: 'essay_update_scoring', label: 'Essay — Update Scoring' },
  { value: 'essay_finish_scoring', label: 'Essay — Finish Scoring' },
  { value: 'registration_sync', label: 'Registration sync' }
]

interface HandlerResult {
  status?: JobStatus
  result: unknown
}

interface JobContext {
  setProgress: (progress: Partial<JobProgress>) => Promise<void>
  submittable?: SubmittableClientConfig
  hereApiKey?: string
  registrationApiKey?: string
  registrationBaseUrl?: string
}

export async function createJob(type: JobType, cycleId: string, createdBy: string, payload: Job['payload'] = {}) {
  return JobModel.create({ type, status: 'pending', cycleId, createdBy, payload })
}

async function queueReviewCompletionRefresh(job: HydratedDocument<Job>) {
  if (job.scheduleRunId) {
    return JobModel.updateOne({ executionKey: `${job._id}:refresh` }, { $setOnInsert: {
      type: 'refresh_review_completion', status: 'waiting', cycleId: job.cycleId, createdBy: job.createdBy,
      scheduleRunId: job.scheduleRunId, scheduleStep: job.scheduleStep, dependencyOf: String(job._id),
      payload: {}, progress: { phase: 'queued', message: 'Queued after scheduled data refresh' }
    } }, { upsert: true })
  }
  return JobModel.create({
    type: 'refresh_review_completion',
    status: 'pending',
    cycleId: job.cycleId,
    createdBy: job.createdBy,
    payload: { triggeredBy: job.type },
    progress: { phase: 'queued', processed: 0, total: 0, percent: 0, message: 'Queued after routing data refresh' }
  })
}

export async function runJob(job: HydratedDocument<Job>, options: { submittable?: SubmittableClientConfig, hereApiKey?: string, registrationApiKey?: string, registrationBaseUrl?: string } = {}) {
  const handler = jobHandlers[job.type]
  if (!handler) throw new Error(`Unknown job type: ${job.type}`)

  const setProgress = async (update: Partial<JobProgress>) => {
    const current = await JobModel.findById(job._id).select('progress').lean()
    const progress: JobProgress = { ...(current?.progress || {}), ...update }
    if (progress.total && progress.processed != null && update.percent == null) {
      progress.percent = Math.min(100, Math.round((progress.processed / progress.total) * 100))
    }
    await JobModel.findByIdAndUpdate(job._id, { $set: { progress } })
  }

  try {
    const output = await handler(job, { setProgress, submittable: options.submittable, hereApiKey: options.hereApiKey, registrationApiKey: options.registrationApiKey, registrationBaseUrl: options.registrationBaseUrl })
    const status = output.status || 'completed'
    const completedAt = status === 'completed' || status === 'failed' ? new Date() : undefined
    await JobModel.findByIdAndUpdate(job._id, {
      $set: {
        status,
        result: output.result,
        ...(job.scheduleRunId ? { workerSettled: true } : {}),
        ...(completedAt ? { completedAt } : {})
      },
      $unset: { leaseExpiresAt: 1, error: 1, ...(completedAt ? { routingLock: 1, essayLock: 1 } : { completedAt: 1 }) }
    })
    return { status, result: output.result }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    await JobModel.findByIdAndUpdate(job._id, {
      $set: {
        status: job.scheduleRunId ? 'running' : 'failed',
        completedAt: job.scheduleRunId ? undefined : new Date(),
        ...(!job.scheduleRunId ? { leaseExpiresAt: undefined } : {}),
        error: message
      }
    })
    throw error
  }
}

function uniqueById<T>(items: T[], getId: (item: T) => string): T[] {
  return [...new Map(items.map(item => [getId(item), item])).values()]
}

const jobHandlers: Record<JobType, (job: HydratedDocument<Job>, context: JobContext) => Promise<HandlerResult>> = {
  metadata_sync: async (job, { setProgress, submittable }) => {
    await setProgress({ phase: 'fetching', message: 'Fetching metadata from Submittable', total: 5, processed: 0 })
    const [rawProjects, rawForms, rawLabels, rawTeam] = await Promise.all([
      fetchProjects(submittable),
      fetchForms(submittable),
      fetchLabels(submittable),
      fetchTeam(submittable)
    ])
    const projects = uniqueById(rawProjects, item => item.projectId)
    const formItems = uniqueById(rawForms, item => item.formId)
    const labels = uniqueById(rawLabels, item => item.labelId)
    const team = uniqueById(rawTeam, item => item.userId)
    await setProgress({ processed: 1, message: `Fetched ${formItems.length} form references` })

    const forms = await mapWithConcurrency(formItems, 3, async (item, index) => {
      const form = await fetchForm(item.formId, submittable)
      if ((index + 1) % 10 === 0 || index + 1 === formItems.length) {
        await setProgress({
          phase: 'fetching_forms',
          total: formItems.length,
          processed: index + 1,
          message: `Fetched ${index + 1} / ${formItems.length} form schemas`
        })
      }
      return form
    })

    const syncedAt = new Date()
    const operations: AnyBulkWriteOperation<Metadata>[] = []
    for (const project of projects) {
      operations.push({ updateOne: { filter: { type: 'project', externalId: project.projectId }, update: { $set: { cycleId: job.cycleId, name: project.name, data: { ...project }, syncedAt } }, upsert: true } })
    }
    for (const form of forms) {
      operations.push({ updateOne: { filter: { type: 'form', externalId: form.formId }, update: { $set: { cycleId: job.cycleId, name: form.name, data: { ...form }, syncedAt } }, upsert: true } })
    }
    for (const label of labels) {
      operations.push({ updateOne: { filter: { type: 'label', externalId: label.labelId }, update: { $set: { cycleId: job.cycleId, name: label.name, data: { ...label }, syncedAt } }, upsert: true } })
    }
    for (const member of team) {
      operations.push({ updateOne: { filter: { type: 'team', externalId: member.userId }, update: { $set: { cycleId: job.cycleId, name: `${member.firstName || ''} ${member.lastName || ''}`.trim() || member.email, data: { ...member }, syncedAt } }, upsert: true } })
    }

    await setProgress({ phase: 'writing', total: operations.length, processed: 0, message: `Writing ${operations.length} metadata records` })
    const batchSize = 1000
    for (let index = 0; index < operations.length; index += batchSize) {
      await MetadataModel.bulkWrite(operations.slice(index, index + batchSize))
      await setProgress({ processed: Math.min(index + batchSize, operations.length) })
    }
    await setProgress({ phase: 'reconciling_stages', message: 'Reconciling review stage IDs' })
    const { applyStageReconcile } = await import('./stageReconcile')
    const reconcile = await applyStageReconcile(job.cycleId, rawProjects, job.createdBy)
    if (reconcile.remappedCount) await queueReviewCompletionRefresh(job)

    await setProgress({ phase: 'linking_internal_forms', message: 'Linking internal forms to applications' })
    const internalFormByProject = new Map(projects.filter(project => project.internalFormId).map(project => [project.projectId, project.internalFormId!]))
    const cycleApplications = await ApplicationModel.find({ cycleId: job.cycleId, projectId: { $in: [...internalFormByProject.keys()] } })
    const internalFormLinks: { applicationId: string, name: string, internalFormId: string, previous?: string, status: 'linked' | 'mismatch' }[] = []
    for (const application of cycleApplications) {
      const internalFormId = internalFormByProject.get(application.projectId)!
      const scoring = (application.scoring || {}) as Record<string, unknown>
      const internalForm = (scoring.internalForm || {}) as Record<string, unknown>
      if (!internalForm.formId) {
        internalForm.formId = internalFormId
        scoring.internalForm = internalForm
        application.scoring = scoring
        application.markModified('scoring')
        await application.save()
        internalFormLinks.push({ applicationId: String(application._id), name: application.name, internalFormId, status: 'linked' })
      } else if (internalForm.formId !== internalFormId) {
        internalFormLinks.push({ applicationId: String(application._id), name: application.name, internalFormId, previous: String(internalForm.formId), status: 'mismatch' })
      }
    }

    await setProgress({ phase: 'completed', processed: operations.length, total: operations.length, percent: 100, message: 'Metadata sync complete' })

    return { result: { projects: projects.length, forms: forms.length, labels: labels.length, team: team.length, internalFormLinks, stageReconcile: reconcile.reports.filter(report => report.remapped.length || report.ambiguous.length || report.orphanStageIds.length || report.newRemoteStages.length) } }
  },

  submission_extraction: async (job, { setProgress }) => {
    const existing = await JobModel.find({ parentJobId: job._id }).sort({ createdAt: 1 })
    if (existing.length) {
      return { status: 'waiting', result: job.result || { forms: [] } }
    }

    const manifest = await getMappedFormManifest(job.cycleId)
    await setProgress({
      phase: 'queued',
      total: manifest.length,
      processed: 0,
      percent: manifest.length ? 0 : 100,
      message: manifest.length ? `Queued 0 / ${manifest.length} mapped forms` : 'No mapped forms to extract'
    })
    if (!manifest.length) return { result: { forms: [], entries: 0 } }

    const children = await JobModel.insertMany(manifest.map(form => ({
      type: 'submission_extraction_form',
      status: 'pending',
      cycleId: job.cycleId,
      createdBy: job.createdBy,
      parentJobId: job._id,
      ...(job.scheduleRunId ? { scheduleRunId: job.scheduleRunId, scheduleStep: job.scheduleStep } : {}),
      formId: form.formId,
      formName: form.formName,
      payload: { formId: form.formId },
      progress: { phase: 'queued', processed: 0, total: 0, percent: 0, message: 'Queued' }
    })))

    return {
      status: 'waiting',
      result: {
        forms: children.map(child => ({
          formId: child.formId,
          formName: child.formName,
          childJobId: String(child._id),
          status: child.status,
          entries: 0
        })),
        entries: 0
      }
    }
  },

  submission_extraction_form: async (job, { setProgress, submittable }) => {
    if (!job.formId) throw new Error('Child extraction job is missing formId')
    const result = await extractFormSubmissions(job.cycleId, job.formId, setProgress, submittable)
    return { result }
  },

  form_response_mapping: async (job, { setProgress }) => {
    const applicationIds = await getApplicationIdsWithMappings(job.cycleId)
    const result = await mapFormResponsesForCycle(job.cycleId, applicationIds, setProgress)
    await queueReviewCompletionRefresh(job)
    return { result: { ...result, applicationsWithMappings: applicationIds.length } }
  },

  run_validation: async (job, { setProgress, submittable }) => {
    const result = await runValidationForCycle(job.cycleId, setProgress)
    await setProgress({ phase: 'syncing_labels', message: 'Synchronizing validation labels with Submittable', percent: 99 })
    const labels = await reconcileValidationLabelsForCycle(job.cycleId, submittable)
    await setProgress({ phase: 'completed', message: `Validation complete. ${labels.added} labels added, ${labels.removed} removed.`, percent: 100 })
    return { result: { ...result, labels } }
  },

  refresh_review_completion: async (job, { setProgress, submittable }) => {
    const result = await refreshReviewCompletion({
      cycleId: job.cycleId,
      applicationId: job.payload?.applicationId,
      batchSize: job.payload?.batchSize,
      dryRun: job.payload?.dryRun === true,
      setProgress
    })
    const withdrawnLabelCleanup = await clearWithdrawnStatusLabels({
      cycleId: job.cycleId,
      applicationId: job.payload?.applicationId,
      dryRun: job.payload?.dryRun === true,
      setProgress,
      submittable
    })
    const labelSync = job.payload?.dryRun === true
      ? undefined
      : await syncGpaStatusLabels({
          cycleId: job.cycleId,
          applicationId: job.payload?.applicationId,
          setProgress,
          submittable
        })
    return { result: { ...result, withdrawnLabelCleanup, labelSync } }
  },

  gpa_status_label_sync: async (job, { setProgress, submittable }) => {
    const result = await syncGpaStatusLabels({
      cycleId: job.cycleId,
      applicationId: job.payload?.applicationId,
      dryRun: job.payload?.dryRun === true,
      setProgress,
      submittable
    })
    return { result }
  },

  hspt_upload_preview: async (job, { setProgress }) => {
    const upload = await HSPTUploadModel.findOne({ _id: job.payload.uploadId, status: 'previewing' })
    if (!upload) throw new Error('Staged HSPT upload is unavailable for preview')

    const preview = {
      files: upload.files.length,
      processed: 0,
      valid: 0,
      invalid: 0,
      errors: [] as string[],
      matching: { linked: 0, needsReview: 0, unlinked: 0, byType: {} as Record<string, number> }
    }
    const totalSteps = upload.files.length + 1
    await setProgress({ phase: 'previewing', total: totalSteps, processed: 0, percent: 0, message: 'Preparing CSV preview' })

    try {
      for (let index = 0; index < upload.files.length; index++) {
        const file = upload.files[index]!
        const result = previewHSPTCsv(file.name, file.content)
        preview.processed += result.processed
        preview.valid += result.valid
        preview.invalid += result.invalid
        preview.errors.push(...result.errors)
        await setProgress({
          processed: index + 1,
          message: `Previewed ${index + 1} of ${upload.files.length} files`
        })
      }
      await setProgress({ phase: 'matching', processed: upload.files.length, message: 'Previewing HSPT matches' })
      preview.matching = await previewHSPTMatching(upload.cycleId, upload.files)
      await setProgress({ phase: 'completed', processed: totalSteps, percent: 100, message: 'Preview complete' })
      await HSPTUploadModel.findByIdAndUpdate(upload._id, { $set: { status: 'ready', preview, error: undefined } })
      return { result: preview }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await HSPTUploadModel.findByIdAndUpdate(upload._id, { $set: { status: 'failed', error: message } })
      throw error
    }
  },

  hspt_upload_commit: async (job, { setProgress }) => {
    const upload = await HSPTUploadModel.findOne({ _id: job.payload.uploadId, status: 'confirming' })
    if (!upload) throw new Error('Staged HSPT upload is unavailable for import')

    const result = { processed: 0, inserted: 0, updated: 0, errors: [] as string[], matching: { exact: 0, fuzzy: 0, unmatched: 0, byType: {} as Record<string, number> } }
    const totalSteps = upload.files.length + 1
    await setProgress({ phase: 'importing', total: totalSteps, processed: 0, percent: 0, message: 'Starting HSPT import' })

    try {
      for (let index = 0; index < upload.files.length; index++) {
        const file = upload.files[index]!
        const fileResult = await parseAndUpsertHSPTCsv(upload.cycleId, file.name, file.content)
        result.processed += fileResult.processed
        result.inserted += fileResult.inserted
        result.updated += fileResult.updated
        result.errors.push(...fileResult.errors)
        await setProgress({
          processed: index + 1,
          message: `Imported ${index + 1} of ${upload.files.length} files`
        })
      }

      await setProgress({ phase: 'matching', processed: upload.files.length, message: 'Matching HSPT results to submissions' })
      result.matching = await runHSPTMatching(upload.cycleId)
      await setProgress({ phase: 'completed', processed: totalSteps, percent: 100, message: 'HSPT import and matching complete' })
      await HSPTUploadModel.findByIdAndUpdate(upload._id, {
        $set: { status: 'completed', result, files: [], error: undefined }
      })
      await queueReviewCompletionRefresh(job)
      return { result }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await HSPTUploadModel.findByIdAndUpdate(upload._id, { $set: { status: 'failed', error: message } })
      throw error
    }
  },

  catchment_lookup: async (job, { setProgress, hereApiKey }) => {
    const result = await runCatchmentForCycle(job.cycleId, setProgress, {
      hereApiKey,
      force: Boolean(job.payload?.force)
    })
    return { result }
  },

  dpscd_gpa_import: async (job, { setProgress }) => {
    const result = await importDpscdGpaRecords(String(job.payload.uploadId), String(job._id), setProgress, job.payload.dryRun === true)
    if (job.payload.dryRun !== true) await queueReviewCompletionRefresh(job)
    return { result }
  },

  optin_gpa_preview: async (job, { setProgress, submittable }) => {
    const result = await previewOptInGpaUpload(String(job.payload.uploadId), setProgress, submittable)
    return { result }
  },

  optin_gpa_commit: async (job, { setProgress, submittable }) => {
    const result = await commitOptInGpaUpload(String(job.payload.uploadId), setProgress, submittable)
    await queueReviewCompletionRefresh(job)
    return { result }
  },

  run_routing: async (job, { setProgress, submittable }) => {
    if (job.payload?.scope) {
      const { runRoutingBatches } = await import('./routingBatches')
      const output = await runRoutingBatches(job, submittable)
      if (output.status === 'completed') await queueReviewCompletionRefresh(job)
      return output
    }
    const { executeRoutingRun } = await import('./routingExecutor')
    const result = await executeRoutingRun({
      cycleId: job.cycleId,
      applicationId: job.payload?.applicationId,
      labelId: job.payload?.labelId,
      limit: job.payload?.limit,
      excludeSubmissionIds: job.payload?.excludeSubmissionIds,
      dryRun: job.payload?.dryRun === true,
      actor: job.createdBy,
      jobId: String(job._id),
      setProgress,
      submittable
    })
    await queueReviewCompletionRefresh(job)
    return { result }
  },

  score_compilation: async (job, { setProgress, submittable }) => {
    const { runScoreCompilation, normalizeScoringConfig } = await import('./scoreCompilation')
    const { syncInternalForms } = await import('./internalFormSync')
    const payload = (job.payload || {}) as { applicationId?: string, dryRun?: boolean }
    const dryRun = payload.dryRun === true

    await setProgress({ phase: 'compiling', message: 'Compiling scores' })
    const compilation = await runScoreCompilation({
      cycleId: job.cycleId,
      applicationId: payload.applicationId,
      dryRun,
      jobId: String(job._id),
      setProgress
    })

    const internalFormSyncs = []
    if (!dryRun) {
      for (const detail of compilation.result.applications) {
        const application = await ApplicationModel.findById(detail.applicationId).select('name scoring').lean()
        const config = normalizeScoringConfig(application?.scoring)
        if (!config.internalForm?.formId) continue
        await setProgress({ phase: 'syncing_internal_forms', message: `Writing internal forms for ${application?.name}` })
        const sync = await syncInternalForms({
          cycleId: job.cycleId,
          applicationId: detail.applicationId,
          config,
          actor: job.createdBy,
          jobId: String(job._id),
          setProgress,
          submittable
        })
        internalFormSyncs.push({ applicationId: detail.applicationId, name: application?.name, ...sync })
      }
    }

    return {
      result: {
        ...compilation.result,
        internalFormSyncs
      }
    }
  },

  essay_begin_scoring: async (job, { setProgress, submittable }) => {
    const { runEssayBeginScoring } = await import('./essayScoring')
    const result = await runEssayBeginScoring({
      cycleId: job.cycleId,
      actor: job.createdBy,
      jobId: String(job._id),
      setProgress,
      submittable
    })
    return { result }
  },

  essay_update_scoring: async (job, { setProgress, submittable }) => {
    const { runEssayUpdateScoring } = await import('./essayScoring')
    const result = await runEssayUpdateScoring({
      cycleId: job.cycleId,
      actor: job.createdBy,
      jobId: String(job._id),
      setProgress,
      submittable
    })
    return { result }
  },

  essay_finish_scoring: async (job, { setProgress, submittable }) => {
    const { runEssayFinishScoring } = await import('./essayScoring')
    return runEssayFinishScoring({
      cycleId: job.cycleId,
      actor: job.createdBy,
      jobId: String(job._id),
      setProgress,
      submittable
    }, job)
  },

  registration_sync: async (job, { setProgress, registrationApiKey, registrationBaseUrl }) => {
    const { runRegistrationSync } = await import('./registrationSync')
    const result = await runRegistrationSync({
      cycleId: job.cycleId,
      setProgress,
      dryRun: job.payload?.dryRun === true,
      apiKey: registrationApiKey,
      baseUrl: registrationBaseUrl
    })
    return { result }
  }
}
