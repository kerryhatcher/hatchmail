import type { H3Event } from 'h3'
import { getBindings, getClientIp, nowIso } from './cloudflare'

export async function writeAudit(
  event: H3Event,
  input: {
    actorUserId?: string | null
    action: string
    targetType?: string | null
    targetId?: string | null
    details?: Record<string, unknown>
  },
): Promise<void> {
  const { DB } = getBindings(event)
  await DB.prepare(`
    INSERT INTO audit_log (id, actor_user_id, action, target_type, target_id, details_json, ip_address, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    input.actorUserId ?? null,
    input.action,
    input.targetType ?? null,
    input.targetId ?? null,
    JSON.stringify(input.details ?? {}),
    getClientIp(event),
    nowIso(),
  ).run()
}
