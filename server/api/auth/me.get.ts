import { requireUser } from '../../utils/auth'
import { getBindings } from '../../utils/cloudflare'

interface AddressRow {
  id: string
  local_part: string
  domain_id: string
  domain_name: string
  is_primary: number
  can_send: number
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const { DB } = getBindings(event)
  const { results } = await DB.prepare(`
    SELECT a.id, a.local_part, a.domain_id, d.name AS domain_name, a.is_primary, a.can_send
    FROM addresses a
    JOIN domains d ON d.id = a.domain_id
    WHERE a.user_id = ? AND d.active = 1
    ORDER BY a.is_primary DESC, d.name, a.local_part
  `).bind(user.id).all<AddressRow>()

  return {
    user,
    addresses: results.map(address => ({
      id: address.id,
      localPart: address.local_part,
      domainId: address.domain_id,
      domain: address.domain_name,
      email: `${address.local_part}@${address.domain_name}`,
      isPrimary: Boolean(address.is_primary),
      canSend: Boolean(address.can_send),
    })),
  }
})
