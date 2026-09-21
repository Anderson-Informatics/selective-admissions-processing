import { useAuth } from '~/composables/useAuth'

export default defineNuxtRouteMiddleware(async (to) => {
  if (
    to.path === '/login' ||
    to.path.startsWith('/api/') ||
    to.path.startsWith('/_') ||
    to.path.startsWith('/__')
  ) {
    return
  }

  const auth = useAuth()
  if (auth.loading.value) {
    await auth.fetchUser()
  }

  if (!auth.user.value) {
    return navigateTo('/login')
  }
})
