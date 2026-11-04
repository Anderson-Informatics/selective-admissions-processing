import { CycleModel } from '~~/server/models/Cycle'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  await connectDb()
  const cycles = await CycleModel.find().sort({ year: -1 })
  return cycles
})
