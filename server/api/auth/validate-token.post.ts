import { findValidToken } from '../../utils/authTokens'

export default defineEventHandler(async (event) => {
  const { token } = await readBody(event)
  await connectDb()

  for (const type of ['invite', 'reset'] as const) {
    const found = await findValidToken(token, type)
    if (found) {
      return { valid: true, type, email: found.email }
    }
  }
  return { valid: false }
})
