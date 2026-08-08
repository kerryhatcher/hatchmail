/// <reference types="@cloudflare/workers-types" />

export {}

declare module 'h3' {
  interface H3EventContext {
    cloudflare: {
      request: Request
      env: {
        DB: D1Database
        ATTACHMENTS: R2Bucket
        SETTINGS_ENCRYPTION_KEY?: string
        BOOTSTRAP_TOKEN?: string
        SESSION_TTL_DAYS?: string
        PASSWORD_PBKDF2_ITERATIONS?: string
      }
      context: ExecutionContext
    }
  }
}
