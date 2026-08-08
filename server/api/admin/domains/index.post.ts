import { readBody } from 'h3'
import { requireAdmin, requireSameOrigin } from '../../../utils/auth'
import { getBindings, nowIso } from '../../../utils/cloudflare'
import { encryptSetting } from '../../../utils/crypto'
import { writeAudit } from '../../../utils/audit'
import { normalizeDomain, validateDomain } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const admin = await requireAdmin(event)
  const body = await readBody<{ name?: string; region?: 'us' | 'eu'; active?: boolean; apiKey?: string; signingKey?: string }>(event)
  const name = normalizeDomain(body.name)
  validateDomain(name)
  const region = body.region === 'eu' ? 'eu' : 'us'
  const { DB, SETTINGS_ENCRYPTION_KEY } = getBindings(event)
  if ((body.apiKey || body.signingKey) && !SETTINGS_ENCRYPTION_KEY) {
    throw createError({ statusCode: 503, statusMessage: 'SETTINGS_ENCRYPTION_KEY must be configured before saving Mailgun credentials' })
  }
  const apiKey = body.apiKey ? await encryptSetting(body.apiKey.trim(), SETTINGS_ENCRYPTION_KEY!) : null
  const signingKey = body.signingKey ? await encryptSetting(body.signingKey.trim(), SETTINGS_ENCRYPTION_KEY!) : null
  const id = crypto.randomUUID()
  const now = nowIso()
  try {
    await DB.prepare(`
      INSERT INTO domains (id, name, mailgun_region, mailgun_api_key_enc, mailgun_signing_key_enc, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, name, region, apiKey, signingKey, Number(body.active !== false), now, now).run()
  } catch (error) {
    throw createError({ statusCode: 409, statusMessage: 'That domain is already configured', cause: error })
  }
  await writeAudit(event, { actorUserId: admin.id, action: 'admin.domain.create', targetType: 'domain', targetId: id, details: { name, region } })
  return { id }
})
