<script setup>
definePageMeta({
  layout: false
})

const route = useRoute()
const token = computed(() => String(route.query.token ?? ''))

const checking = ref(true)
const valid = ref(false)
const accountEmail = ref('')
const password = ref('')
const confirm = ref('')
const error = ref('')
const loading = ref(false)
const done = ref(false)

onMounted(async () => {
  try {
    const result = await $fetch('/api/auth/validate-token', {
      method: 'POST',
      body: { token: token.value }
    })
    valid.value = result.valid && result.type === 'reset'
    accountEmail.value = result.email ?? ''
  } catch {
    valid.value = false
  } finally {
    checking.value = false
  }
})

async function onSubmit() {
  error.value = ''
  if (password.value !== confirm.value) {
    error.value = 'Passwords do not match.'
    return
  }
  loading.value = true

  try {
    await $fetch('/api/auth/reset-password', {
      method: 'POST',
      body: { token: token.value, password: password.value }
    })
    done.value = true
  } catch (err) {
    error.value = err?.data?.statusMessage || 'Could not reset your password. The link may have expired.'
  }

  loading.value = false
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4 bg-muted/30">
    <UCard class="w-full max-w-sm">
      <template #header>
        <PageHeader
          title="Reset Password"
          help="resetPassword"
        >
          <p class="text-sm text-muted mt-1">
            Choose a new password for your account
          </p>
        </PageHeader>
      </template>

      <p
        v-if="checking"
        class="text-sm text-muted"
      >
        Validating your reset link…
      </p>

      <div
        v-else-if="done"
        class="space-y-4"
      >
        <p class="text-sm">
          Your password has been updated. You can now sign in.
        </p>
        <UButton
          to="/login"
          color="primary"
          block
        >
          Sign in
        </UButton>
      </div>

      <p
        v-else-if="!valid"
        class="text-sm text-red-600"
      >
        This reset link is invalid or has expired. Ask a site administrator to
        send you a new one.
      </p>

      <form
        v-else
        class="space-y-4"
        @submit.prevent="onSubmit"
      >
        <p class="text-sm text-muted">
          Resetting password for <strong>{{ accountEmail }}</strong>
        </p>

        <UInput
          v-model="password"
          type="password"
          label="New password"
          autocomplete="new-password"
          required
        />

        <UInput
          v-model="confirm"
          type="password"
          label="Confirm password"
          autocomplete="new-password"
          required
        />

        <p class="text-xs text-muted">
          Password must be at least 12 characters and contain a letter and a number.
        </p>

        <p
          v-if="error"
          class="text-sm text-red-600"
        >
          {{ error }}
        </p>

        <UButton
          type="submit"
          color="primary"
          block
          :loading="loading"
        >
          Reset password
        </UButton>
      </form>
    </UCard>
  </div>
</template>
