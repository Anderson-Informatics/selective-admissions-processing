import { MetadataModel } from '../../models/Metadata'

export default defineEventHandler(async (event) => {
  await connectDb()
  await requireAuth(event)
  const labels = await MetadataModel.find({ type: 'label' }).select('externalId name').sort({ name: 1 }).lean()
  return labels.map(label => ({ value: label.externalId, label: label.name }))
})
