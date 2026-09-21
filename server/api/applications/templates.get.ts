import { routingTemplates } from '~~/server/config/seeds/routing'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  return Object.entries(routingTemplates).map(([key, template]) => ({
    key,
    name: template.name,
    description: template.description,
    draft: template.draft === true,
    config: template
  }))
})
