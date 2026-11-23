import { ApplicationModel } from '../../../models/Application'
import { ReviewStageModel } from '../../../models/ReviewStage'
import { FieldMappingModel } from '../../../models/FieldMapping'
import { loadSchoolDirectory } from '../../../utils/schoolDirectory'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  await connectDb()
  const application = await ApplicationModel.findById(getRouterParam(event, 'id')).lean()
  if (!application) throw createError({ statusCode: 404, statusMessage: 'Application not found' })
  const [directory, stages, mappings] = await Promise.all([
    loadSchoolDirectory(application.cycleId, String(application._id)),
    ReviewStageModel.find({ applicationId: String(application._id) }).sort({ order: 1 }).lean(),
    FieldMappingModel.find({ cycleId: application.cycleId }).select('formId canonicalName').lean()
  ])
  return {
    schools: directory.schools.map(school => ({ id: school.id, name: school.name, active: school.active })),
    authorities: directory.effectiveAuthorities.map(authority => ({ schoolId: authority.schoolId, userId: authority.userId, applicationId: authority.applicationId, version: authority.version, name: directory.members.find(member => member.userId === authority.userId)?.name || authority.userId, valid: directory.representatives.some(rep => rep.active && rep.userId === authority.userId && rep.schoolIds.includes(authority.schoolId)) })),
    stages: stages.map(stage => ({ stageId: stage.stageId, name: stage.name, fields: [...new Set(mappings.filter(mapping => mapping.formId === stage.formId).map(mapping => mapping.canonicalName).filter(Boolean))] }))
  }
})
