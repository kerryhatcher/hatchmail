import { createError, type H3Event } from 'h3'

export interface HatchmailBindings {
  DB: D1Database
  ATTACHMENTS: R2Bucket
  SETTINGS_ENCRYPTION_KEY?: string
  BOOTSTRAP_TOKEN?: string
  SESSION_TTL_DAYS?: string
  PASSWORD_PBKDF2_ITERATIONS?: string
}

export function getBindings(event: H3Event): HatchmailBindings {
  const env = event.context.cloudflare?.env as HatchmailBindings | undefined
  if (!env?.DB) {
    throw createError({ statusCode: 500, statusMessage: 'Cloudflare D1 binding DB is not available' })
  }
  return env
}

export function getClientIp(event: H3Event): string | null {
  return event.req.headers.get('cf-connecting-ip') || event.req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null
}

export function nowIso(): string {
  return new Date().toISOString()
}
