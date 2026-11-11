// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui'
  ],

  devtools: {
    enabled: process.env.NODE_ENV !== 'production'
  },

  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    mongodbUri: '',
    mongodbLookupUri: '',
    submittableApiKey: '',
    submittableBaseUrl: 'https://submittable-api.submittable.com/v4',
    submittableV3BaseUrl: 'https://submittable-api.submittable.com/v3',
    hereApiKey: '',
    registrationApiKey: '',
    registrationBaseUrl: 'https://ehs-registration-v2.netlify.app',
    authSecret: '',
    dataKey: '',
    dataSecret: '',
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

  routeRules: {
    '/': { prerender: false },
    '/**': {
      headers: {
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
        // Nuxt renders its SSR payload as an inline script, so 'unsafe-inline'
        // is required here unless inline scripts are disabled app-wide.
        'Content-Security-Policy': 'default-src \'self\'; script-src \'self\' \'unsafe-inline\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data:; connect-src \'self\'; font-src \'self\'; object-src \'none\'; base-uri \'self\'; form-action \'self\'; frame-ancestors \'none\''
      }
    }
  },

  compatibilityDate: '2026-06-30',

  nitro: {
    externals: {
      inline: ['xlsx']
    }
  },

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  },

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
  }
})
