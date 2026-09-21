import { CycleModel } from '~~/server/models/Cycle'
import { normalizeCycleRounds } from '~~/server/utils/cycleRounds'

export default defineEventHandler(async (event) => {
  await connectDb()

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Cycle ID is required' })
  }

  const body = await readBody(event)

  if (!body.year || !body.name) {
    throw createError({ statusCode: 400, statusMessage: 'New year and name are required' })
  }

  const existing = await CycleModel.findOne({ year: body.year })
  if (existing) {
    throw createError({ statusCode: 409, statusMessage: `A cycle for year ${body.year} already exists` })
  }

  const source = await CycleModel.findById(id).lean()
  if (!source) {
    throw createError({ statusCode: 404, statusMessage: 'Source cycle not found' })
  }

  let rounds
  try {
    rounds = body.rounds !== undefined ? normalizeCycleRounds(body.rounds) : source.rounds || []
  } catch (error: unknown) {
    throw createError({ statusCode: 400, statusMessage: error instanceof Error ? error.message : 'Invalid cycle rounds' })
  }

  const clone = await CycleModel.create({
    year: body.year,
    name: body.name,
    active: false,
    startDate: body.startDate ? new Date(body.startDate) : source.startDate,
    endDate: body.endDate ? new Date(body.endDate) : source.endDate,
    rounds,
    scoreWeights: source.scoreWeights || {}
  })

  return clone
})
