export interface AuthUser {
  email: string
  password?: string
}

export function useAuth() {
  const user = useState<Pick<AuthUser, 'email'> | null>('auth-user', () => null)
  const loading = useState('auth-loading', () => true)
  const loggedIn = computed(() => !!user.value)

  async function fetchUser() {
    try {
      const $fetchApi = import.meta.server ? useRequestFetch() : $fetch
      user.value = await $fetchApi('/api/auth/me') as Pick<AuthUser, 'email'>
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
      }) as { email: string }
      user.value = { email: result.email }
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
    fetchUser,
    login,
    logout
  }
}
