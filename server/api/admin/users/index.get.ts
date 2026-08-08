import { requireAdmin } from '../../../utils/auth'
import { getBindings } from '../../../utils/cloudflare'

interface UserRow {
  id: string
  username: string
  display_name: string
  role: 'user' | 'admin'
  status: 'active' | 'suspended'
  created_at: string
  last_active_at: string | null
}

interface AddressRow {
  id: string
  user_id: string
  domain_id: string
  local_part: string
  domain_name: string
  is_primary: number
  can_send: number
}

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const { DB } = getBindings(event)
  const [{ results: users }, { results: addresses }] = await Promise.all([
    DB.prepare(`
      SELECT id, username, display_name, role, status, created_at, last_active_at
      FROM users ORDER BY display_name COLLATE NOCASE, username COLLATE NOCASE
    `).all<UserRow>(),
    DB.prepare(`
      SELECT a.id, a.user_id, a.domain_id, a.local_part, d.name AS domain_name, a.is_primary, a.can_send
      FROM addresses a JOIN domains d ON d.id = a.domain_id
      ORDER BY a.is_primary DESC, d.name, a.local_part
    `).all<AddressRow>(),
  ])
  const byUser = new Map<string, AddressRow[]>()
  for (const address of addresses) byUser.set(address.user_id, [...(byUser.get(address.user_id) || []), address])
  return {
    users: users.map(user => ({
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
      status: user.status,
      createdAt: user.created_at,
      lastActiveAt: user.last_active_at,
      addresses: (byUser.get(user.id) || []).map(address => ({
        id: address.id,
        domainId: address.domain_id,
        localPart: address.local_part,
        domain: address.domain_name,
        email: `${address.local_part}@${address.domain_name}`,
        isPrimary: Boolean(address.is_primary),
        canSend: Boolean(address.can_send),
      })),
    })),
  }
})
