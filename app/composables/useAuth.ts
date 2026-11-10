export interface AuthUser {
  email: string
  role: 'site_admin' | 'central_admin'
}

export function useAuth() {
  const user = useState<AuthUser | null>('auth-user', () => null)
  const loading = useState('auth-loading', () => true)
  const loggedIn = computed(() => !!user.value)
  const isSiteAdmin = computed(() => user.value?.role === 'site_admin')

  async function fetchUser() {
    try {
      const $fetchApi = import.meta.server ? useRequestFetch() : $fetch
      user.value = await $fetchApi('/api/auth/me') as AuthUser
    } catch {
      user.value = null
    } finally {
      loading.value = false
    }
  }

  async function login(email: string, password: string) {
    try {
      const result = await $fetch('/api/auth/login', {
        method: 'POST',
        body: { email, password }
      }) as AuthUser
      user.value = { email: result.email, role: result.role }
      return true
    } catch {
      user.value = null
      return false
    }
  }

  async function logout() {
    try {
      await $fetch('/api/auth/logout', { method: 'POST' })
    } finally {
      user.value = null
      await navigateTo('/login')
    }
  }

  return {
    user,
    loading,
    loggedIn,
    isSiteAdmin,
    fetchUser,
    login,
    logout
  }
}
