import { MetadataModel } from '../../models/Metadata'

const confirmationText = 'DELETE_DUPLICATE_METADATA'

interface DuplicateDocument {
  _id: unknown
  updatedAt?: Date
}

interface DuplicateGroup {
  _id: { type: string, externalId: string }
  documents: DuplicateDocument[]
  count: number
}

export default defineEventHandler(async (event) => {
  await connectDb()
  await requireAuth(event)
  const body = await readBody(event)
  const apply = body?.apply === true

  if (apply && body?.confirmation !== confirmationText) {
    throw createError({
      statusCode: 400,
      statusMessage: `Set confirmation to ${confirmationText} to apply this destructive migration`
    })
  }

  const groups = await MetadataModel.aggregate<DuplicateGroup>([
    {
      $group: {
        _id: { type: '$type', externalId: '$externalId' },
        documents: { $push: { _id: '$_id', updatedAt: '$updatedAt' } },
        count: { $sum: 1 }
      }
    },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } }
  ]).allowDiskUse(true)

  for (const group of groups) {
    group.documents.sort((left, right) => new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime())
  }

  const preview = groups.map(group => ({
    type: group._id.type,
    externalId: group._id.externalId,
    count: group.count,
    keepId: String(group.documents[0]!._id),
    removeIds: group.documents.slice(1).map(document => String(document._id))
  }))

  if (!apply) {
    return {
      apply: false,
      confirmationRequired: confirmationText,
      duplicateGroups: preview.length,
      documentsToRemove: preview.reduce((sum, group) => sum + group.removeIds.length, 0),
      groups: preview
    }
  }

  for (const group of groups) {
    const [keeperRef, ...duplicateRefs] = group.documents
    const documents = await MetadataModel.find({ _id: { $in: group.documents.map(document => document._id) } }).lean()
    const keeper = documents.find(document => String(document._id) === String(keeperRef!._id))!
    const duplicates = documents.filter(document => String(document._id) !== String(keeperRef!._id))
    const mergedData = Object.assign({}, ...[...duplicates, keeper].map(document => document.data || {}))
    await MetadataModel.findByIdAndUpdate(keeper._id, { $set: { data: mergedData } })
    await MetadataModel.deleteMany({ _id: { $in: duplicateRefs.map(document => document._id) } })
  }

  const collection = MetadataModel.collection
  const indexes = await collection.indexes()
  const oldIndex = indexes.find(index => index.name === 'cycleId_1_type_1_externalId_1')
  if (oldIndex?.name) await collection.dropIndex(oldIndex.name)
  await collection.createIndex({ type: 1, externalId: 1 }, { unique: true, name: 'type_1_externalId_1' })

  return {
    apply: true,
    duplicateGroups: preview.length,
    documentsRemoved: preview.reduce((sum, group) => sum + group.removeIds.length, 0)
  }
})
