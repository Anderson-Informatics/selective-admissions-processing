<script setup>
definePageMeta({
  layout: false
})

const email = ref('')
const submitted = ref(false)
const error = ref('')
const loading = ref(false)

async function onSubmit() {
  loading.value = true
  error.value = ''

  try {
    await $fetch('/api/auth/forgot-password', {
      method: 'POST',
      body: { email: email.value }
    })
    submitted.value = true
  } catch {
    error.value = 'Something went wrong. Please try again.'
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
          help="forgotPassword"
        >
          <p class="text-sm text-muted mt-1">
            Enter your account email
          </p>
        </PageHeader>
      </template>

      <div
        v-if="submitted"
        class="space-y-4"
      >
        <p class="text-sm">
          If an account exists for that email, an administrator will be notified
          and can send you a password reset link.
        </p>
        <UButton
          to="/login"
          color="primary"
          variant="soft"
          block
        >
          Back to sign in
        </UButton>
      </div>

      <form
        v-else
        class="space-y-4"
        @submit.prevent="onSubmit"
      >
        <UInput
          v-model="email"
          type="email"
          label="Email"
          placeholder="you@example.com"
          autocomplete="email"
          required
        />

        <p class="text-xs text-muted">
          Your request will be flagged for a site administrator, who will send
          you a reset link manually.
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
          Request reset
        </UButton>
      </form>
    </UCard>
  </div>
</template>
