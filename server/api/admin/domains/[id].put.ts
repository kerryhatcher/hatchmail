import { getRouterParam, readBody } from 'h3'
import { requireAdmin, requireSameOrigin } from '../../../utils/auth'
import { getBindings, nowIso } from '../../../utils/cloudflare'
import { encryptSetting } from '../../../utils/crypto'
import { writeAudit } from '../../../utils/audit'
import { normalizeDomain, validateDomain } from '../../../utils/validation'

interface ExistingDomain {
  id: string
  name: string
  mailgun_region: 'us' | 'eu'
  mailgun_api_key_enc: string | null
  mailgun_signing_key_enc: string | null
  active: number
}

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const admin = await requireAdmin(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Domain id is required' })
  const { DB, SETTINGS_ENCRYPTION_KEY } = getBindings(event)
  const existing = await DB.prepare(`
    SELECT id, name, mailgun_region, mailgun_api_key_enc, mailgun_signing_key_enc, active FROM domains WHERE id = ?
  `).bind(id).first<ExistingDomain>()
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Domain not found' })
  const body = await readBody<{
    name?: string
    region?: 'us' | 'eu'
    active?: boolean
    apiKey?: string
    signingKey?: string
    clearApiKey?: boolean
    clearSigningKey?: boolean
  }>(event)
  const name = body.name === undefined ? existing.name : normalizeDomain(body.name)
  validateDomain(name)
  const region = body.region === undefined ? existing.mailgun_region : body.region
  if (!['us', 'eu'].includes(region)) throw createError({ statusCode: 400, statusMessage: 'Invalid Mailgun region' })
  const active = body.active === undefined ? Boolean(existing.active) : body.active
  if ((body.apiKey || body.signingKey) && !SETTINGS_ENCRYPTION_KEY) {
    throw createError({ statusCode: 503, statusMessage: 'SETTINGS_ENCRYPTION_KEY must be configured before saving Mailgun credentials' })
  }
  const apiKey = body.clearApiKey
    ? null
    : body.apiKey
      ? await encryptSetting(body.apiKey.trim(), SETTINGS_ENCRYPTION_KEY!)
      : existing.mailgun_api_key_enc
  const signingKey = body.clearSigningKey
    ? null
    : body.signingKey
      ? await encryptSetting(body.signingKey.trim(), SETTINGS_ENCRYPTION_KEY!)
      : existing.mailgun_signing_key_enc
  try {
    await DB.prepare(`
      UPDATE domains SET name = ?, mailgun_region = ?, mailgun_api_key_enc = ?, mailgun_signing_key_enc = ?, active = ?, updated_at = ?
      WHERE id = ?
    `).bind(name, region, apiKey, signingKey, Number(active), nowIso(), id).run()
  } catch (error) {
    throw createError({ statusCode: 409, statusMessage: 'That domain is already configured', cause: error })
  }
  await writeAudit(event, { actorUserId: admin.id, action: 'admin.domain.update', targetType: 'domain', targetId: id, details: { name, region, active } })
  return { ok: true }
})
