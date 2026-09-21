<script setup>
definePageMeta({
  layout: false
})

const auth = useAuth()
const email = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

onMounted(async () => {
  await auth.fetchUser()
  if (auth.user.value) {
    await navigateTo('/')
  }
})

async function onSubmit() {
  loading.value = true
  error.value = ''

  const success = await auth.login(email.value, password.value)

  if (success) {
    await navigateTo('/')
  } else {
    error.value = 'Invalid email or password.'
  }

  loading.value = false
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4 bg-muted/30">
    <UCard class="w-full max-w-sm">
      <template #header>
        <div class="text-center">
          <h1 class="text-2xl font-semibold">
            EHS Admissions
          </h1>
          <p class="text-sm text-muted mt-1">
            Sign in to continue
          </p>
        </div>
      </template>

      <form class="space-y-4" @submit.prevent="onSubmit">
        <UInput
          v-model="email"
          type="email"
          label="Email"
          placeholder="you@example.com"
          autocomplete="email"
          required
        />

        <UInput
          v-model="password"
          type="password"
          label="Password"
          placeholder="••••••••"
          autocomplete="current-password"
          required
        />

        <p v-if="error" class="text-sm text-red-600">
          {{ error }}
        </p>

        <UButton
          type="submit"
          color="primary"
          block
          :loading="loading"
        >
          Sign in
        </UButton>
      </form>
    </UCard>
  </div>
</template>
