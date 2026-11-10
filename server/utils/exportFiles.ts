import { ExportFileModel } from '../models/ExportFile'

// PII exports expire rather than living forever inside job results.
const EXPORT_TTL_DAYS = 7

export async function persistJobExport(jobId: string | undefined, file: { name: string, base64: string }) {
  const doc = await ExportFileModel.create({
    jobId: jobId ?? '',
    name: file.name,
    data: Buffer.from(file.base64, 'base64'),
    expiresAt: new Date(Date.now() + EXPORT_TTL_DAYS * 24 * 60 * 60 * 1000)
  })
  return { name: file.name, exportFileId: String(doc._id), expiresAt: doc.expiresAt }
}
