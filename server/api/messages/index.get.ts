import { getQuery } from 'h3'
import { requireUser } from '../../utils/auth'
import { getBindings } from '../../utils/cloudflare'

interface MessageRow {
  id: string
  direction: 'inbound' | 'outbound'
  folder: string
  sender: string | null
  from_header: string | null
  to_json: string
  subject: string
  body_text: string
  is_read: number
  is_starred: number
  created_at: string
  received_at: string | null
  sent_at: string | null
  attachment_count: number
}

const folders = new Set(['inbox', 'sent', 'archive', 'trash'])

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const { DB } = getBindings(event)
  const query = getQuery(event)
  const folder = typeof query.folder === 'string' && folders.has(query.folder) ? query.folder : 'inbox'
  const limit = Math.max(1, Math.min(100, Number.parseInt(String(query.limit || '50'), 10) || 50))
  const { results } = await DB.prepare(`
    SELECT m.id, m.direction, m.folder, m.sender, m.from_header, m.to_json, m.subject, m.body_text,
           m.is_read, m.is_starred, m.created_at, m.received_at, m.sent_at,
           (SELECT COUNT(*) FROM attachments a WHERE a.message_id = m.id) AS attachment_count
    FROM messages m
    WHERE m.user_id = ? AND m.folder = ?
    ORDER BY COALESCE(m.received_at, m.sent_at, m.created_at) DESC
    LIMIT ?
  `).bind(user.id, folder, limit).all<MessageRow>()

  const unread = await DB.prepare(`
    SELECT COUNT(*) AS count FROM messages WHERE user_id = ? AND folder = 'inbox' AND is_read = 0
  `).bind(user.id).first<{ count: number }>()

  return {
    folder,
    unreadCount: unread?.count ?? 0,
    messages: results.map(row => ({
      id: row.id,
      direction: row.direction,
      folder: row.folder,
      sender: row.sender,
      from: row.from_header,
      to: JSON.parse(row.to_json || '[]'),
      subject: row.subject,
      preview: row.body_text.replace(/\s+/g, ' ').trim().slice(0, 180),
      isRead: Boolean(row.is_read),
      isStarred: Boolean(row.is_starred),
      attachmentCount: row.attachment_count,
      timestamp: row.received_at || row.sent_at || row.created_at,
    })),
  }
})
