import { getRouterParam } from 'h3'
import { requireUser } from '../../utils/auth'
import { getBindings } from '../../utils/cloudflare'

interface MessageRow {
  id: string
  direction: string
  folder: string
  sender: string | null
  envelope_sender: string | null
  from_header: string | null
  to_json: string
  cc_json: string
  bcc_json: string
  subject: string
  body_text: string
  body_html: string
  headers_json: string
  message_id_header: string | null
  in_reply_to: string | null
  is_read: number
  is_starred: number
  created_at: string
  received_at: string | null
  sent_at: string | null
}

interface AttachmentRow {
  id: string
  filename: string
  content_type: string
  size: number
  content_id: string | null
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Message id is required' })
  const { DB } = getBindings(event)
  const message = await DB.prepare(`
    SELECT id, direction, folder, sender, envelope_sender, from_header, to_json, cc_json, bcc_json,
           subject, body_text, body_html, headers_json, message_id_header, in_reply_to,
           is_read, is_starred, created_at, received_at, sent_at
    FROM messages WHERE id = ? AND user_id = ?
  `).bind(id, user.id).first<MessageRow>()
  if (!message) throw createError({ statusCode: 404, statusMessage: 'Message not found' })
  const { results: attachments } = await DB.prepare(`
    SELECT id, filename, content_type, size, content_id FROM attachments WHERE message_id = ? ORDER BY created_at
  `).bind(id).all<AttachmentRow>()

  if (!message.is_read) await DB.prepare('UPDATE messages SET is_read = 1 WHERE id = ?').bind(id).run()

  return {
    message: {
      id: message.id,
      direction: message.direction,
      folder: message.folder,
      sender: message.sender,
      envelopeSender: message.envelope_sender,
      from: message.from_header,
      to: JSON.parse(message.to_json || '[]'),
      cc: JSON.parse(message.cc_json || '[]'),
      bcc: JSON.parse(message.bcc_json || '[]'),
      subject: message.subject,
      bodyText: message.body_text,
      bodyHtml: message.body_html,
      headers: JSON.parse(message.headers_json || '[]'),
      messageId: message.message_id_header,
      inReplyTo: message.in_reply_to,
      isRead: true,
      isStarred: Boolean(message.is_starred),
      timestamp: message.received_at || message.sent_at || message.created_at,
      attachments: attachments.map(attachment => ({
        id: attachment.id,
        filename: attachment.filename,
        contentType: attachment.content_type,
        size: attachment.size,
        contentId: attachment.content_id,
        downloadUrl: `/attachments/${attachment.id}`,
      })),
    },
  }
})
