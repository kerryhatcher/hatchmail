import { getRouterParam } from 'h3'
import { requireAdmin, requireSameOrigin } from '../../../utils/auth'
import { getBindings } from '../../../utils/cloudflare'
import { writeAudit } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const admin = await requireAdmin(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'User id is required' })
  if (id === admin.id) throw createError({ statusCode: 400, statusMessage: 'You cannot delete your own account' })
  const { DB, ATTACHMENTS } = getBindings(event)
  const { results: keys } = await DB.prepare(`
    SELECT a.r2_key FROM attachments a JOIN messages m ON m.id = a.message_id WHERE m.user_id = ?
  `).bind(id).all<{ r2_key: string }>()
  const result = await DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run()
  if (!result.meta.changes) throw createError({ statusCode: 404, statusMessage: 'User not found' })
  await Promise.allSettled(keys.map(row => ATTACHMENTS.delete(row.r2_key)))
  await writeAudit(event, { actorUserId: admin.id, action: 'admin.user.delete', targetType: 'user', targetId: id })
  return { ok: true }
})
