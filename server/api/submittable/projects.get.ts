export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const projects = await fetchProjects()
  return projects.map(p => ({
    projectId: p.projectId,
    name: p.name,
    initialFormId: p.initialFormId,
    reviewStages: (p.reviewStages || []).map(s => ({
      reviewStageId: s.reviewStageId,
      stageName: s.stageName,
      type: s.type,
      formId: s.formId,
      stageOrder: s.stageOrder
    }))
  }))
})
