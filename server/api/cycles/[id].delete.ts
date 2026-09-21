import { CycleModel } from '~~/server/models/Cycle'

export default defineEventHandler(async (event) => {
  await connectDb()

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Cycle ID is required' })
  }

  const cycle = await CycleModel.findByIdAndDelete(id)
  if (!cycle) {
    throw createError({ statusCode: 404, statusMessage: 'Cycle not found' })
  }

  return { ok: true }
})
