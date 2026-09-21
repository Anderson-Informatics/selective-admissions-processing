export default defineEventHandler(async (event) => {
  const { email, password } = await readBody(event)

  if (!email || !password) {
    throw createError({ statusCode: 400, statusMessage: 'Email and password are required' })
  }

  const user = getAuthUsers().find(
    (u) => u.email.toLowerCase() === String(email).toLowerCase() && u.password === password
  )

  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid email or password' })
  }

  await setAuthSession(event, { email: user.email })

  return { email: user.email }
})
