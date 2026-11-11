import { Types } from 'mongoose'
import { GpaUploadModel } from '~~/server/models/GpaUpload'
import { JobModel } from '~~/server/models/Job'
import { requireDpscdAccess } from '../../../utils/dpscdAuth'
import { recordDisclosure } from '../../../utils/disclosureAudit'

export default defineEventHandler(async (event) => {
  const user = await requireDpscdAccess(event)
  await connectDb()
  const id = getRouterParam(event, 'id')
  if (!id || !Types.ObjectId.isValid(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid upload ID' })

  const upload = await GpaUploadModel.findOne({ _id: id, createdBy: user.email, source: 'dpscd' }).select('-files -records').lean()
  if (!upload) throw createError({ statusCode: 404, statusMessage: 'DPSCD GPA upload not found' })

  const job = upload.importJobId
    ? await (user.apiKey
        ? JobModel.findOne({ _id: upload.importJobId, type: 'dpscd_gpa_import', createdBy: user.email })
        : JobModel.findById(upload.importJobId)).select('status progress result error').lean()
    : null

  if (user.apiKey) await recordDisclosure({ actor: user.email, action: 'data_api_disclosure', entityType: 'GpaUpload', entityId: id })
  return { upload, job }
})
