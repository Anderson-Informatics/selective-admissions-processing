import type { AnyBulkWriteOperation } from 'mongoose'
import type { JobProgress } from '../models/Job'
import { FormEntryModel, type FormEntry } from '../models/FormEntry'
import { ReviewModel, type Review } from '../models/Review'
import { SubmissionModel, type Submission } from '../models/Submission'
import { getCycleEntryContext } from './mappingStatus'
import { convertSubmissionIdsToInts, fetchEntriesForForm, fetchSubmissionsForProject, fetchV3SubmissionInts, type SubmittableClientConfig } from './submittable'
import { mapWithConcurrency } from './concurrency'

type ProgressFn = (update: Partial<JobProgress>) => Promise<void>

export interface FormExtractionResult {
  formId: string
  pages: number
  entries: number
  skippedEntries: number
  submissionsStaged: number
}

export async function extractFormSubmissions(
  cycleId: string,
  formId: string,
  setProgress?: ProgressFn,
  clientConfig?: SubmittableClientConfig
): Promise<FormExtractionResult> {
  const { applicationIdByProjectId, stageNameByFormAndProject, reviewStageByFormAndStage, reviewStageByApplicationAndStage } = await getCycleEntryContext(cycleId)
  let pages = 0
  let entries = 0
  let skippedEntries = 0
  const submissionApplicationMap = new Map<string, string>()
  const encounteredProjectIds = new Set<string>()

  await setProgress?.({
    phase: 'extracting',
    processed: 0,
    total: 0,
    percent: 0,
    message: `Starting extraction for ${formId}`
  })

  await fetchEntriesForForm(formId, async (items, page) => {
    pages = page
    const formEntryOps: AnyBulkWriteOperation<FormEntry>[] = []
    const submissionOps: AnyBulkWriteOperation<Submission>[] = []
    const reviewOps: AnyBulkWriteOperation<Review>[] = []

    for (const item of items) {
      const entry = item.entry
      if (!entry) continue

      if (item.formType === 'review') {
        const stageContext = reviewStageByFormAndStage[`${formId}|${entry.stageId}`]
        if (!stageContext) {
          skippedEntries += 1
          continue
        }

        reviewOps.push({
          updateOne: {
            filter: { entryId: entry.entryId },
            update: {
              $set: {
                cycleId,
                applicationId: stageContext.applicationId,
                submissionId: entry.submissionId,
                stageId: entry.stageId,
                stageName: stageContext.stageName,
                stageOrder: stageContext.stageOrder,
                requiredForProgress: stageContext.requiredForProgress,
                reviewerId: entry.reviewerId,
                score: entry.score,
                isAssigned: entry.isAssigned,
                entryId: entry.entryId,
                formId: entry.formId,
                status: entry.status,
                completedAt: entry.completedAt ? new Date(entry.completedAt) : undefined,
                createdBy: entry.createdBy,
                createdAt: entry.createdAt ? new Date(entry.createdAt) : undefined,
                fieldData: entry.fieldData || [],
                mappedData: {},
                isMapped: false
              }
            },
            upsert: true
          }
        })
        continue
      }

      const projectId = entry.projectId
      if (!projectId) {
        skippedEntries += 1
        continue
      }
      const applicationId = applicationIdByProjectId[projectId]
      if (!applicationId) {
        skippedEntries += 1
        continue
      }

      submissionApplicationMap.set(entry.submissionId, applicationId)
      encounteredProjectIds.add(projectId)

      formEntryOps.push({
        updateOne: {
          filter: { entryId: entry.entryId },
          update: {
            $set: {
              cycleId,
              applicationId,
              projectId,
              submissionId: entry.submissionId,
              entryId: entry.entryId,
              formId: entry.formId,
              formType: item.formType || 'initial',
              status: entry.status,
              completedAt: entry.completedAt ? new Date(entry.completedAt) : undefined,
              createdBy: entry.createdBy,
              createdAt: entry.createdAt ? new Date(entry.createdAt) : undefined,
              fieldData: entry.fieldData || [],
              mappedData: {},
              isMapped: false
            }
          },
          upsert: true
        }
      })

      const stageName = stageNameByFormAndProject[`${formId}|${projectId}`]
      const addToSet: Record<string, string> = { entryIds: entry.entryId }
      if (stageName) addToSet.stageNames = stageName

      submissionOps.push({
        updateOne: {
          filter: { submissionId: entry.submissionId },
          update: {
            $set: {
              cycleId,
              applicationId,
              projectId,
              submissionId: entry.submissionId,
              status: entry.status,
              createdAt: entry.createdAt ? new Date(entry.createdAt) : undefined,
              completedAt: entry.completedAt ? new Date(entry.completedAt) : undefined,
              createdBy: entry.createdBy,
              mappedFields: {},
              isMapped: false
            },
            $addToSet: addToSet
          },
          upsert: true
        }
      })
    }

    if (formEntryOps.length) await FormEntryModel.bulkWrite(formEntryOps)
    if (submissionOps.length) await SubmissionModel.bulkWrite(submissionOps)
    if (reviewOps.length) await ReviewModel.bulkWrite(reviewOps)

    entries += formEntryOps.length + reviewOps.length
    await setProgress?.({
      phase: 'extracting',
      processed: entries,
      total: entries,
      percent: 0,
      message: `Page ${page}: ${entries} entries saved${skippedEntries ? `, ${skippedEntries} skipped` : ''}`
    })
  }, clientConfig)

  let submissionsStaged = 0
  if (submissionApplicationMap.size > 0) {
    await setProgress?.({
      phase: 'staging',
      processed: 0,
      total: submissionApplicationMap.size,
      percent: 0,
      message: `Fetching current stages for ${submissionApplicationMap.size} submissions`
    })

    const stageIdBySubmissionId = new Map<string, string>()
    const statusBySubmissionId = new Map<string, string>()
    const labelIdsBySubmissionId = new Map<string, string[]>()
    await mapWithConcurrency([...encounteredProjectIds], 3, async (projectId) => {
      const submissions = await fetchSubmissionsForProject(projectId, clientConfig)
      for (const submission of submissions) {
        if (!submissionApplicationMap.has(submission.submissionId)) continue
        if (submission.reviewStageId) {
          stageIdBySubmissionId.set(submission.submissionId, submission.reviewStageId)
        }
        if (submission.status) {
          statusBySubmissionId.set(submission.submissionId, submission.status)
        }
        if (submission.labels) {
          labelIdsBySubmissionId.set(submission.submissionId, submission.labels)
        }
      }
    })

    const stageUpdateOps: AnyBulkWriteOperation<Submission>[] = []
    for (const [submissionId, applicationId] of submissionApplicationMap) {
      const stageId = stageIdBySubmissionId.get(submissionId)
      const status = statusBySubmissionId.get(submissionId)
      const labelIds = labelIdsBySubmissionId.get(submissionId)
      const set: Record<string, unknown> = {}
      if (stageId) {
        const stageContext = reviewStageByApplicationAndStage[`${applicationId}|${stageId}`]
        set.currentStageId = stageId
        set.currentStageName = stageContext?.stageName || ''
      }
      if (status) set.status = status
      if (labelIds) set.labelIds = labelIds
      if (!Object.keys(set).length) continue
      stageUpdateOps.push({
        updateOne: {
          filter: { submissionId },
          update: { $set: set }
        }
      })
    }

    if (stageUpdateOps.length) {
      await SubmissionModel.bulkWrite(stageUpdateOps)
      submissionsStaged = stageUpdateOps.length
    }

    const projectIds = [...encounteredProjectIds]
    if (projectIds.length) {
      const v3IntIds = await fetchV3SubmissionInts(projectIds, clientConfig)
      const idMap = await convertSubmissionIdsToInts(v3IntIds, clientConfig)
      const intUpdateOps: AnyBulkWriteOperation<Submission>[] = []
      for (const [submissionIdInt, submissionId] of idMap.entries()) {
        if (submissionApplicationMap.has(submissionId)) {
          intUpdateOps.push({
            updateOne: {
              filter: { cycleId, submissionId },
              update: { $set: { submissionIdInt } }
            }
          })
        }
      }
      const result = intUpdateOps.length ? await SubmissionModel.bulkWrite(intUpdateOps) : null
      console.log(`Submission ID mapping: fetched=${v3IntIds.length}, converted=${idMap.size}, matched=${intUpdateOps.length}, modified=${result?.modifiedCount || 0}`)
    }
  }

  await setProgress?.({
    phase: 'completed',
    processed: entries,
    total: entries,
    percent: 100,
    message: `Extraction complete: ${entries} entries${submissionsStaged ? `, ${submissionsStaged} stages updated` : ''}`
  })

  return { formId, pages, entries, skippedEntries, submissionsStaged }
}
