import { getRouterParam } from 'h3'
import { requireUser } from '../../utils/auth'
import { getBindings } from '../../utils/cloudflare'

interface AttachmentRow {
  r2_key: string
  filename: string
  content_type: string
}

function quotedFilename(filename: string): string {
  return filename.replace(/["\\\r\n]/g, '_')
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Attachment id is required' })
  const { DB, ATTACHMENTS } = getBindings(event)
  const attachment = await DB.prepare(`
    SELECT a.r2_key, a.filename, a.content_type
    FROM attachments a
    JOIN messages m ON m.id = a.message_id
    WHERE a.id = ? AND m.user_id = ?
  `).bind(id, user.id).first<AttachmentRow>()
  if (!attachment) throw createError({ statusCode: 404, statusMessage: 'Attachment not found' })
  const object = await ATTACHMENTS.get(attachment.r2_key)
  if (!object) throw createError({ statusCode: 404, statusMessage: 'Attachment data not found' })

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('Content-Type', attachment.content_type || headers.get('Content-Type') || 'application/octet-stream')
  headers.set('Content-Disposition', `attachment; filename="${quotedFilename(attachment.filename)}"`)
  headers.set('Cache-Control', 'private, no-store')
  if (object.size) headers.set('Content-Length', String(object.size))
  return new Response(object.body, { headers })
})
