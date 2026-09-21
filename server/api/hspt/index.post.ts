import { parseAndUpsertHSPTCsv, runHSPTMatching } from '~~/server/utils/hspt'

export default defineEventHandler(async (event) => {
  await connectDb()
  await requireAuth(event)

  const parts = await readMultipartFormData(event)
  if (!parts?.length) {
    throw createError({ statusCode: 400, statusMessage: 'No files uploaded' })
  }

  let cycleId = ''
  const files: { name: string, content: string }[] = []

  for (const part of parts) {
    if (part.name === 'cycleId') {
      cycleId = part.data.toString('utf8')
    } else if (part.filename) {
      files.push({
        name: part.filename,
        content: part.data.toString('utf8')
      })
    }
  }

  if (!cycleId) {
    throw createError({ statusCode: 400, statusMessage: 'cycleId is required' })
  }

  if (!files.length) {
    throw createError({ statusCode: 400, statusMessage: 'At least one CSV file is required' })
  }

  let processed = 0
  let inserted = 0
  let updated = 0
  const errors: string[] = []

  for (const file of files) {
    const result = await parseAndUpsertHSPTCsv(cycleId, file.name, file.content)
    processed += result.processed
    inserted += result.inserted
    updated += result.updated
    errors.push(...result.errors)
  }

  const matchResult = await runHSPTMatching(cycleId)

  return {
    processed,
    inserted,
    updated,
    errors,
    matching: matchResult
  }
})
