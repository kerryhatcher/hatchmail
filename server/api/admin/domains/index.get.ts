import { requireAdmin } from '../../../utils/auth'
import { getBindings } from '../../../utils/cloudflare'

interface DomainRow {
  id: string
  name: string
  mailgun_region: 'us' | 'eu'
  mailgun_api_key_enc: string | null
  mailgun_signing_key_enc: string | null
  active: number
  created_at: string
  updated_at: string
  address_count: number
}

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const { DB } = getBindings(event)
  const { results } = await DB.prepare(`
    SELECT d.id, d.name, d.mailgun_region, d.mailgun_api_key_enc, d.mailgun_signing_key_enc, d.active,
           d.created_at, d.updated_at, (SELECT COUNT(*) FROM addresses a WHERE a.domain_id = d.id) AS address_count
    FROM domains d ORDER BY d.name COLLATE NOCASE
  `).all<DomainRow>()
  return {
    domains: results.map(domain => ({
      id: domain.id,
      name: domain.name,
      region: domain.mailgun_region,
      active: Boolean(domain.active),
      apiKeyConfigured: Boolean(domain.mailgun_api_key_enc),
      signingKeyConfigured: Boolean(domain.mailgun_signing_key_enc),
      addressCount: domain.address_count,
      createdAt: domain.created_at,
      updatedAt: domain.updated_at,
    })),
  }
})
