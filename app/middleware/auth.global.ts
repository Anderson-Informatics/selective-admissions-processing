import { useAuth } from '~/composables/useAuth'

export default defineNuxtRouteMiddleware(async (to) => {
  if (
    to.path === '/login'
    || to.path === '/forgot-password'
    || to.path === '/accept-invite'
    || to.path === '/reset-password'
    || to.path.startsWith('/api/')
    || to.path.startsWith('/_')
    || to.path.startsWith('/__')
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

  if (to.path.startsWith('/admin') && !auth.isSiteAdmin.value) {
    return navigateTo('/')
  }
})
