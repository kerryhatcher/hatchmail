import { getRouterParam, readBody } from 'h3'
import { requireSameOrigin, requireUser } from '../../utils/auth'
import { getBindings } from '../../utils/cloudflare'

const folders = new Set(['inbox', 'archive', 'trash'])

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Message id is required' })
  const body = await readBody<{ folder?: string; isRead?: boolean; isStarred?: boolean }>(event)
  const { DB } = getBindings(event)
  const existing = await DB.prepare('SELECT id, folder FROM messages WHERE id = ? AND user_id = ?').bind(id, user.id).first<{ id: string; folder: string }>()
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Message not found' })

  const folder = body.folder === undefined ? existing.folder : body.folder
  if (body.folder !== undefined && !folders.has(body.folder)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid destination folder' })
  }

  await DB.prepare(`
    UPDATE messages
    SET folder = ?, is_read = COALESCE(?, is_read), is_starred = COALESCE(?, is_starred)
    WHERE id = ? AND user_id = ?
  `).bind(
    folder,
    body.isRead === undefined ? null : Number(body.isRead),
    body.isStarred === undefined ? null : Number(body.isStarred),
    id,
    user.id,
  ).run()

  return { ok: true }
})
