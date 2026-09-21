import { CycleModel } from '~~/server/models/Cycle'
import { normalizeCycleRounds } from '~~/server/utils/cycleRounds'

export default defineEventHandler(async (event) => {
  await connectDb()

  const body = await readBody(event)

  if (!body.year || !body.name) {
    throw createError({ statusCode: 400, statusMessage: 'Year and name are required' })
  }

  const existing = await CycleModel.findOne({ year: body.year })
  if (existing) {
    throw createError({ statusCode: 409, statusMessage: `A cycle for year ${body.year} already exists` })
  }

  let rounds
  try {
    rounds = normalizeCycleRounds(body.rounds)
  } catch (error: unknown) {
    throw createError({ statusCode: 400, statusMessage: error instanceof Error ? error.message : 'Invalid cycle rounds' })
  }

  const cycle = await CycleModel.create({
    year: body.year,
    name: body.name,
    active: body.active === true,
    startDate: body.startDate ? new Date(body.startDate) : undefined,
    endDate: body.endDate ? new Date(body.endDate) : undefined,
    rounds,
    scoreWeights: body.scoreWeights || {}
  })

  if (cycle.active) {
    await CycleModel.updateMany({ _id: { $ne: cycle._id } }, { active: false })
  }

  return cycle
})
