import { createError, type H3Event } from 'h3'
import { getBindings } from './cloudflare'
import { decryptSetting, hmacSha256Hex, timingSafeEqual } from './crypto'

export interface DomainRow {
  id: string
  name: string
  mailgun_region: 'us' | 'eu'
  mailgun_api_key_enc: string | null
  mailgun_signing_key_enc: string | null
  active: number
}

function requireEncryptionKey(event: H3Event): string {
  const { SETTINGS_ENCRYPTION_KEY } = getBindings(event)
  if (!SETTINGS_ENCRYPTION_KEY) {
    throw createError({ statusCode: 500, statusMessage: 'SETTINGS_ENCRYPTION_KEY is not configured' })
  }
  return SETTINGS_ENCRYPTION_KEY
}

export async function getDomainByName(event: H3Event, domainName: string): Promise<DomainRow | null> {
  const { DB } = getBindings(event)
  return DB.prepare(`
    SELECT id, name, mailgun_region, mailgun_api_key_enc, mailgun_signing_key_enc, active
    FROM domains WHERE name = ? COLLATE NOCASE
  `).bind(domainName).first<DomainRow>()
}

export async function getMailgunApiKey(event: H3Event, domain: DomainRow): Promise<string> {
  if (!domain.mailgun_api_key_enc) throw createError({ statusCode: 409, statusMessage: 'Mailgun API key is not configured for this domain' })
  return decryptSetting(domain.mailgun_api_key_enc, requireEncryptionKey(event))
}

export async function getMailgunSigningKey(event: H3Event, domain: DomainRow): Promise<string> {
  if (!domain.mailgun_signing_key_enc) throw createError({ statusCode: 409, statusMessage: 'Mailgun signing key is not configured for this domain' })
  return decryptSetting(domain.mailgun_signing_key_enc, requireEncryptionKey(event))
}

export async function verifyMailgunSignature(
  event: H3Event,
  domain: DomainRow,
  timestamp: string,
  token: string,
  signature: string,
): Promise<boolean> {
  const seconds = Number.parseInt(timestamp, 10)
  if (!Number.isFinite(seconds)) return false
  const ageMs = Math.abs(Date.now() - seconds * 1000)
  if (ageMs > 15 * 60_000) return false
  const signingKey = await getMailgunSigningKey(event, domain)
  const expected = await hmacSha256Hex(signingKey, `${timestamp}${token}`)
  return timingSafeEqual(expected, signature.toLowerCase())
}

export async function sendMailgunMessage(
  event: H3Event,
  domain: DomainRow,
  form: FormData,
): Promise<{ id: string; message: string }> {
  const apiKey = await getMailgunApiKey(event, domain)
  const base = domain.mailgun_region === 'eu' ? 'https://api.eu.mailgun.net' : 'https://api.mailgun.net'
  const response = await fetch(`${base}/v3/${encodeURIComponent(domain.name)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`api:${apiKey}`)}` },
    body: form,
  })
  const text = await response.text()
  if (!response.ok) {
    throw createError({
      statusCode: 502,
      statusMessage: `Mailgun send failed (${response.status})`,
      data: { providerResponse: text.slice(0, 500) },
    })
  }
  try {
    return JSON.parse(text) as { id: string; message: string }
  } catch {
    return { id: '', message: text }
  }
}
