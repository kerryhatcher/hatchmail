export default defineNuxtConfig({
  compatibilityDate: '2026-08-08',
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  nitro: {
    preset: 'cloudflare',
  },
  app: {
    head: {
      title: 'Hatchmail',
      meta: [
        { name: 'description', content: 'Cloudflare-native webmail powered by Mailgun' },
      ],
    },
  },
  typescript: {
    strict: true,
    typeCheck: true,
  },
})
