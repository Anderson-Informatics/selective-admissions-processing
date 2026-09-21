export default defineEventHandler(async (event) => {
  await clearAuthSession(event)
  return { ok: true }
})
