<script setup>
useHead({
  titleTemplate: title => title ? `${title} — EHS Admissions` : 'EHS Admissions',
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1' }
  ],
  link: [
    { rel: 'icon', href: '/favicon.ico' }
  ],
  htmlAttrs: {
    lang: 'en'
  }
})

const route = useRoute()
const auth = useAuth()
</script>

<template>
  <UApp>
    <UHeader
      v-if="route.path !== '/login'"
      title="EHS Admissions"
      to="/"
    >
      <template #right>
        <div class="flex items-center gap-3">
          <UButton
            v-if="auth.user"
            to="/cycles"
            color="neutral"
            variant="ghost"
          >
            Cycles
          </UButton>
          <UButton
            v-if="auth.user"
            to="/applications"
            color="neutral"
            variant="ghost"
          >
            Applications
          </UButton>
          <UButton
            v-if="auth.user"
            to="/mappings"
            color="neutral"
            variant="ghost"
          >
            Mappings
          </UButton>
          <UButton
            v-if="auth.user"
            to="/submissions"
            color="neutral"
            variant="ghost"
          >
            Submissions
          </UButton>
          <UButton
            v-if="auth.user"
            to="/jobs"
            color="neutral"
            variant="ghost"
          >
            Jobs
          </UButton>
          <UButton
            v-if="auth.user"
            to="/routing"
            color="neutral"
            variant="ghost"
          >
            Routing
          </UButton>
          <UButton
            v-if="auth.user"
            to="/hspt"
            color="neutral"
            variant="ghost"
          >
            HSPT
          </UButton>
          <UButton
            v-if="auth.user"
            to="/gpa"
            color="neutral"
            variant="ghost"
          >
            GPA
          </UButton>
          <span
            v-if="auth.user"
            class="text-sm text-muted hidden sm:inline"
          >
            {{ auth.user.email }}
          </span>
          <UButton
            v-if="auth.user"
            color="neutral"
            variant="ghost"
            @click="auth.logout"
          >
            Logout
          </UButton>
        </div>
      </template>
    </UHeader>

    <UMain>
      <NuxtPage />
    </UMain>
  </UApp>
</template>
