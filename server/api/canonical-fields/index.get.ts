import { CANONICAL_FIELDS } from '~~/server/utils/legacyFieldMap'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  return CANONICAL_FIELDS
})
