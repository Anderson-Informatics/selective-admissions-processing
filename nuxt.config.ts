// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui'
  ],

  devtools: {
    enabled: true
  },

  css: ['~/assets/css/main.css'],

  icon: {
    clientBundle: {
      scan: true,
      icons: [
        'lucide:plus',
        'lucide:pencil',
        'lucide:trash-2',
        'lucide:copy',
        'lucide:loader',
        'lucide:search',
        'lucide:save',
        'lucide:eye',
        'lucide:map-pin',
        'lucide:refresh-cw'
      ]
    }
  },

  routeRules: {
    '/': { prerender: false }
  },

  runtimeConfig: {
    mongodbUri: '',
    mongodbLookupUri: '',
    submittableApiKey: '',
    submittableBaseUrl: 'https://submittable-api.submittable.com/v4',
    submittableV3BaseUrl: 'https://submittable-api.submittable.com/v3',
    hereApiKey: '',
    authUsers: '',
    authSecret: '',
    msalTenantId: '',
    msalClientId: '',
    msalClientSecret: '',
    msalRedirectUri: '',
    teamsWebhookUrl: '',
    teamsWebhookSecret: '',
    jobDispatchSecret: '',
    jobConcurrency: 3,
    jobMaxAttempts: 3,
    hsptFuzzyThreshold: 0.6,
    public: {
      appUrl: ''
    }
  },

  compatibilityDate: '2026-06-30',

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  }
})
