import { loadSchoolDirectory } from '../../../utils/schoolDirectory'
import { SubmissionModel } from '../../../models/Submission'
import { DEFAULT_PREFERENCE_FIELDS } from '../../../utils/decisionConfig'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'site_admin')
  await connectDb()
  const { cycleId = '', applicationId = '' } = getQuery(event)
  const [directory, choices] = await Promise.all([
    loadSchoolDirectory(String(cycleId), String(applicationId)),
    cycleId ? Promise.all(DEFAULT_PREFERENCE_FIELDS.map(field => SubmissionModel.distinct(`mappedFields.${field}`, { cycleId: String(cycleId) }))) : Promise.resolve([])
  ])
  return { ...directory, choiceSuggestions: [...new Set(choices.flat().filter((value): value is string => typeof value === 'string' && Boolean(value.trim())))].sort() }
})
