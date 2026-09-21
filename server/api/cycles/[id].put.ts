import { CycleModel } from '~~/server/models/Cycle'
import { normalizeCycleRounds } from '~~/server/utils/cycleRounds'

export default defineEventHandler(async (event) => {
  await connectDb()

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Cycle ID is required' })
  }

  const body = await readBody(event)

  const cycle = await CycleModel.findById(id)
  if (!cycle) {
    throw createError({ statusCode: 404, statusMessage: 'Cycle not found' })
  }

  if (body.year && body.year !== cycle.year) {
    const existing = await CycleModel.findOne({ year: body.year, _id: { $ne: id } })
    if (existing) {
      throw createError({ statusCode: 409, statusMessage: `A cycle for year ${body.year} already exists` })
    }
    cycle.year = body.year
  }

  if (body.name !== undefined) cycle.name = body.name
  if (body.active !== undefined) cycle.active = body.active === true
  if (body.startDate !== undefined) cycle.startDate = body.startDate ? new Date(body.startDate) : undefined
  if (body.endDate !== undefined) cycle.endDate = body.endDate ? new Date(body.endDate) : undefined
  if (body.scoreWeights !== undefined) cycle.scoreWeights = body.scoreWeights
  if (body.rounds !== undefined) {
    try {
      cycle.rounds = normalizeCycleRounds(body.rounds)
    } catch (error: unknown) {
      throw createError({ statusCode: 400, statusMessage: error instanceof Error ? error.message : 'Invalid cycle rounds' })
    }
  }

  await cycle.save()

  if (cycle.active) {
    await CycleModel.updateMany({ _id: { $ne: cycle._id } }, { active: false })
  }

  return cycle
})
