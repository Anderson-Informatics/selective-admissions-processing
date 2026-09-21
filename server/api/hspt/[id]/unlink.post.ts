import { unlinkHSPTResult } from '~~/server/utils/hspt'

export default defineEventHandler(async (event) => {
  await connectDb()
  await requireAuth(event)

  const { id } = getRouterParams(event)
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'HSPT result id is required' })
  }

  const updated = await unlinkHSPTResult(id)
  if (!updated) {
    throw createError({ statusCode: 404, statusMessage: 'HSPT result not found' })
  }

  return updated
})
