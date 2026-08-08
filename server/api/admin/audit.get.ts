import { getQuery } from 'h3'
import { requireAdmin } from '../../utils/auth'
import { getBindings } from '../../utils/cloudflare'

interface AuditRow {
  id: string
  actor_user_id: string | null
  actor_name: string | null
  action: string
  target_type: string | null
  target_id: string | null
  details_json: string
  ip_address: string | null
  created_at: string
}

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const { DB } = getBindings(event)
  const query = getQuery(event)
  const limit = Math.max(1, Math.min(500, Number.parseInt(String(query.limit || '100'), 10) || 100))
  const { results } = await DB.prepare(`
    SELECT a.id, a.actor_user_id, u.display_name AS actor_name, a.action, a.target_type, a.target_id,
           a.details_json, a.ip_address, a.created_at
    FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id
    ORDER BY a.created_at DESC LIMIT ?
  `).bind(limit).all<AuditRow>()
  return {
    events: results.map(row => ({
      id: row.id,
      actorUserId: row.actor_user_id,
      actorName: row.actor_name,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      details: JSON.parse(row.details_json || '{}'),
      ipAddress: row.ip_address,
      createdAt: row.created_at,
    })),
  }
})
