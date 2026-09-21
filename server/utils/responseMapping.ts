import type { AnyBulkWriteOperation } from 'mongoose'
import type { JobProgress } from '../models/Job'
import { FieldMappingModel } from '../models/FieldMapping'
import { FormEntryModel, type FormEntry } from '../models/FormEntry'
import { MetadataModel } from '../models/Metadata'
import { ReviewModel, type Review } from '../models/Review'
import { SubmissionModel } from '../models/Submission'
import { mapWithConcurrency } from './concurrency'
import { getMappedFormIds } from './mappingStatus'
import { fetchForm, type SubmittableForm } from './submittable'

type ProgressFn = (update: Partial<JobProgress>) => Promise<void>

interface MappedValue {
  canonicalName: string
  value: unknown
}

interface FieldMappingItem {
  canonicalName: string
}

function resolveFieldValues(
  field: Record<string, unknown>,
  formId: string,
  mappingByField: Record<string, FieldMappingItem | undefined>,
  optionLabels: Record<string, Record<string, string>>
): MappedValue[] {
  const formFieldId = field['formFieldId'] as string | undefined
  if (!formFieldId) return []

  const results: MappedValue[] = []
  if (field['fieldType'] === 'name') {
    const firstMapping = mappingByField[`${formId}|${formFieldId}:firstName`]
    if (firstMapping && field['firstName'] !== undefined) {
      results.push({ canonicalName: firstMapping.canonicalName, value: field['firstName'] })
    }
    const lastMapping = mappingByField[`${formId}|${formFieldId}:lastName`]
    if (lastMapping && field['lastName'] !== undefined) {
      results.push({ canonicalName: lastMapping.canonicalName, value: field['lastName'] })
    }
    return results
  }

  if (field['fieldType'] === 'address') {
    const subFields = [
      { key: 'address1', mappingId: `${formFieldId}:address1` },
      { key: 'address2', mappingId: `${formFieldId}:address2` },
      { key: 'city', mappingId: `${formFieldId}:city` },
      { key: 'region', mappingId: `${formFieldId}:region` },
      { key: 'postalCode', mappingId: `${formFieldId}:postalCode` },
      { key: 'country', mappingId: `${formFieldId}:country` }
    ]
    for (const subField of subFields) {
      const mapping = mappingByField[`${formId}|${subField.mappingId}`]
      if (mapping && field[subField.key] !== undefined) {
        results.push({ canonicalName: mapping.canonicalName, value: field[subField.key] })
      }
    }
    return results
  }

  const mapping = mappingByField[`${formId}|${formFieldId}`]
  if (!mapping) return []

  let value: unknown = field['value']
  const options = field['options']
  if (Array.isArray(options) && options.length > 0) {
    value = options.map((optionId: unknown) => optionLabels[formFieldId]?.[String(optionId)] || String(optionId)).join('; ')
  }
  const files = field['files']
  if (Array.isArray(files)) {
    value = files.map((file: unknown) => {
      if (file && typeof file === 'object' && 'fileName' in file) {
        return (file as { fileName?: string }).fileName || String(file)
      }
      return String(file)
    }).join('; ')
  }

  return [{ canonicalName: mapping.canonicalName, value }]
}

export async function mapFormResponsesForCycle(cycleId: string, applicationIds?: string[], setProgress?: ProgressFn) {
  await setProgress?.({ phase: 'loading', total: 1, processed: 0, percent: 0, message: 'Loading mappings and form schemas' })
  const mappedFormIds = await getMappedFormIds(cycleId)
  if (!mappedFormIds.length || applicationIds?.length === 0) {
    await setProgress?.({ phase: 'completed', total: 0, processed: 0, percent: 100, message: 'No mapped entries found' })
    return { formEntries: 0, reviews: 0, submissions: 0 }
  }

  const mappings = await FieldMappingModel.find({
    cycleId,
    formId: { $in: mappedFormIds },
    canonicalName: { $ne: '' }
  }).lean()
  const mappingByField: Record<string, FieldMappingItem | undefined> = {}
  for (const mapping of mappings) {
    mappingByField[`${mapping.formId}|${mapping.fieldId}`] = { canonicalName: mapping.canonicalName }
  }

  const metadata = await MetadataModel.find({ type: 'form', externalId: { $in: mappedFormIds } }).sort({ updatedAt: -1 }).lean()
  const formsById: Record<string, SubmittableForm> = {}
  for (const item of metadata) {
    if (!formsById[item.externalId] && item.data?.fields) formsById[item.externalId] = item.data as SubmittableForm
  }
  const missingFormIds = mappedFormIds.filter(formId => !formsById[formId])
  const missingForms = await mapWithConcurrency<string, SubmittableForm>(missingFormIds, 3, formId => fetchForm(formId))
  for (const form of missingForms) formsById[form.formId] = form

  const optionLabels: Record<string, Record<string, Record<string, string>>> = {}
  for (const formId of mappedFormIds) {
    const formLabels: Record<string, Record<string, string>> = {}
    optionLabels[formId] = formLabels
    for (const field of formsById[formId]?.fields || []) {
      const fieldLabels: Record<string, string> = {}
      formLabels[field.formFieldId] = fieldLabels
      for (const option of field.options || []) {
        fieldLabels[option.formOptionId] = option.label
      }
    }
  }

  const entryFilter: Record<string, unknown> = { cycleId, formId: { $in: mappedFormIds } }
  if (applicationIds?.length) entryFilter.applicationId = { $in: applicationIds }
  const totalFormEntries = await FormEntryModel.countDocuments(entryFilter)
  const totalReviews = await ReviewModel.countDocuments(entryFilter)
  const totalEntries = totalFormEntries + totalReviews
  if (!totalEntries) {
    await setProgress?.({ phase: 'completed', total: 0, processed: 0, percent: 100, message: 'No mapped entries found' })
    return { formEntries: 0, reviews: 0, submissions: 0 }
  }

  const submissionMappedFields: Record<string, Record<string, unknown>> = {}
  const batchSize = 500
  let formEntryOperations: AnyBulkWriteOperation<FormEntry>[] = []
  let reviewOperations: AnyBulkWriteOperation<Review>[] = []
  let processedEntries = 0

  const reportProgress = async () => {
    await setProgress?.({
      phase: 'mapping_entries',
      total: totalEntries,
      processed: processedEntries,
      percent: Math.round((processedEntries / totalEntries) * 90),
      message: `Mapped ${processedEntries} / ${totalEntries} entries`
    })
  }

  const flushFormEntries = async () => {
    if (!formEntryOperations.length) return
    await FormEntryModel.bulkWrite(formEntryOperations)
    formEntryOperations = []
    await reportProgress()
  }

  const flushReviews = async () => {
    if (!reviewOperations.length) return
    await ReviewModel.bulkWrite(reviewOperations)
    reviewOperations = []
    await reportProgress()
  }

  const cursor = FormEntryModel.find(entryFilter)
    .sort({ createdAt: 1, _id: 1 })
    .allowDiskUse(true)
    .lean()
    .cursor()
  for await (const entry of cursor) {
    const mappedData: Record<string, unknown> = {}
    for (const rawField of entry.fieldData || []) {
      const field = rawField as Record<string, unknown>
      const values = resolveFieldValues(field, entry.formId, mappingByField, optionLabels[entry.formId] || {})
      for (const value of values) mappedData[value.canonicalName] = value.value
    }

    formEntryOperations.push({
      updateOne: {
        filter: { _id: entry._id },
        update: { $set: { mappedData, isMapped: true } }
      }
    })
    submissionMappedFields[entry.submissionId] = {
      ...(submissionMappedFields[entry.submissionId] || {}),
      ...mappedData
    }
    processedEntries += 1
    if (formEntryOperations.length >= batchSize) await flushFormEntries()
  }
  await flushFormEntries()
  const processedFormEntries = processedEntries

  const reviewCursor = ReviewModel.find(entryFilter)
    .sort({ createdAt: 1, _id: 1 })
    .allowDiskUse(true)
    .lean()
    .cursor()
  for await (const review of reviewCursor) {
    const mappedData: Record<string, unknown> = {}
    for (const rawField of review.fieldData || []) {
      const field = rawField as Record<string, unknown>
      const values = resolveFieldValues(field, review.formId, mappingByField, optionLabels[review.formId] || {})
      for (const value of values) mappedData[value.canonicalName] = value.value
    }

    reviewOperations.push({
      updateOne: {
        filter: { _id: review._id },
        update: { $set: { mappedData, isMapped: true } }
      }
    })
    processedEntries += 1
    if (reviewOperations.length >= batchSize) await flushReviews()
  }
  await flushReviews()
  const processedReviews = processedEntries - processedFormEntries

  const submissionOperations = Object.entries(submissionMappedFields).map(([submissionId, mappedFields]) => ({
    updateOne: {
      filter: { submissionId },
      update: { $set: { mappedFields, isMapped: true } }
    }
  }))
  const totalSubmissionBatches = Math.ceil(submissionOperations.length / batchSize)
  for (let index = 0; index < submissionOperations.length; index += batchSize) {
    await SubmissionModel.bulkWrite(submissionOperations.slice(index, index + batchSize))
    const batch = Math.floor(index / batchSize) + 1
    await setProgress?.({
      phase: 'writing_submissions',
      total: totalSubmissionBatches,
      processed: batch,
      percent: 90 + Math.round((batch / totalSubmissionBatches) * 10),
      message: `Writing submission batch ${batch} / ${totalSubmissionBatches}`
    })
  }

  await setProgress?.({ phase: 'completed', total: processedEntries, processed: processedEntries, percent: 100, message: 'Response mapping complete' })
  return { formEntries: processedFormEntries, reviews: processedReviews, submissions: submissionOperations.length }
}
