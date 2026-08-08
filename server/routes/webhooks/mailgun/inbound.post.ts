import { setResponseStatus } from 'h3'
import { getBindings, nowIso } from '../../../utils/cloudflare'
import { getDomainByName, verifyMailgunSignature } from '../../../utils/mailgun'

interface RecipientRow {
  address_id: string
  user_id: string
  domain_id: string
}

function textValue(form: FormData, key: string): string {
  const value = form.get(key)
  return typeof value === 'string' ? value : ''
}

function safeJson(value: string, fallback: unknown): unknown {
  try { return JSON.parse(value) } catch { return fallback }
}

function attachmentName(file: File): string {
  const normalized = (file.name || 'attachment').replace(/[\\/\u0000-\u001f]/g, '_').trim()
  return normalized.slice(0, 240) || 'attachment'
}

export default defineEventHandler(async (event) => {
  const { DB, ATTACHMENTS } = getBindings(event)
  const form = await event.req.formData()
  const recipient = textValue(form, 'recipient').trim().toLowerCase()
  const at = recipient.lastIndexOf('@')
  if (at <= 0 || at === recipient.length - 1) {
    setResponseStatus(event, 406)
    return 'Not Applicable'
  }

  const localPart = recipient.slice(0, at)
  const domainName = recipient.slice(at + 1)
  const domain = await getDomainByName(event, domainName)
  if (!domain || !domain.active) {
    setResponseStatus(event, 406)
    return 'Not Applicable'
  }

  const timestamp = textValue(form, 'timestamp')
  const token = textValue(form, 'token')
  const signature = textValue(form, 'signature')
  if (!timestamp || !token || !signature || !(await verifyMailgunSignature(event, domain, timestamp, token, signature))) {
    setResponseStatus(event, 406)
    return 'Invalid signature'
  }

  const replay = await DB.prepare('SELECT token FROM webhook_tokens WHERE token = ?').bind(token).first<{ token: string }>()
  if (replay) return 'OK'

  const recipientRow = await DB.prepare(`
    SELECT a.id AS address_id, a.user_id, a.domain_id
    FROM addresses a
    JOIN users u ON u.id = a.user_id
    JOIN domains d ON d.id = a.domain_id
    WHERE a.local_part = ? COLLATE NOCASE AND d.name = ? COLLATE NOCASE AND u.status = 'active' AND d.active = 1
  `).bind(localPart, domainName).first<RecipientRow>()
  if (!recipientRow) {
    setResponseStatus(event, 406)
    return 'Not Applicable'
  }

  await DB.prepare('DELETE FROM webhook_tokens WHERE expires_at <= ?').bind(nowIso()).run()

  const id = crypto.randomUUID()
  const createdAt = nowIso()
  const headersRaw = textValue(form, 'message-headers')
  const headers = safeJson(headersRaw, [])
  const contentIdMap = safeJson(textValue(form, 'content-id-map'), {}) as Record<string, string>
  const bodyHtml = form.getAll('body-html').filter(value => typeof value === 'string').join('\n')
  const attachmentCount = Math.max(0, Number.parseInt(textValue(form, 'attachment-count') || '0', 10) || 0)
  const attachmentStatements: D1PreparedStatement[] = []
  const storedKeys: string[] = []

  try {
    for (let index = 1; index <= attachmentCount; index++) {
      const value = form.get(`attachment-${index}`)
      if (!(value instanceof File)) continue
      const attachmentId = crypto.randomUUID()
      const filename = attachmentName(value)
      const key = `messages/${recipientRow.user_id}/${id}/${attachmentId}/${filename}`
      await ATTACHMENTS.put(key, value.stream(), {
        httpMetadata: { contentType: value.type || 'application/octet-stream' },
        customMetadata: { messageId: id, filename },
      })
      storedKeys.push(key)
      const contentId = Object.entries(contentIdMap).find(([, mapped]) => mapped === `attachment-${index}`)?.[0] ?? null
      attachmentStatements.push(DB.prepare(`
        INSERT INTO attachments (id, message_id, r2_key, filename, content_type, size, content_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(attachmentId, id, key, filename, value.type || 'application/octet-stream', value.size, contentId, createdAt))
    }

    const messageStatement = DB.prepare(`
      INSERT INTO messages (
        id, user_id, domain_id, address_id, direction, folder, sender, envelope_sender, from_header,
        to_json, cc_json, subject, body_text, body_html, headers_json, message_id_header, in_reply_to,
        is_read, created_at, received_at
      ) VALUES (?, ?, ?, ?, 'inbound', 'inbox', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).bind(
      id,
      recipientRow.user_id,
      recipientRow.domain_id,
      recipientRow.address_id,
      textValue(form, 'sender'),
      textValue(form, 'sender'),
      textValue(form, 'from'),
      JSON.stringify([recipient]),
      JSON.stringify(textValue(form, 'Cc') ? [textValue(form, 'Cc')] : []),
      textValue(form, 'subject'),
      textValue(form, 'body-plain'),
      bodyHtml,
      JSON.stringify(headers),
      textValue(form, 'Message-Id') || textValue(form, 'message-id') || null,
      textValue(form, 'In-Reply-To') || null,
      createdAt,
      createdAt,
    )
    const tokenStatement = DB.prepare(`
      INSERT INTO webhook_tokens (token, domain_id, created_at, expires_at) VALUES (?, ?, ?, ?)
    `).bind(token, domain.id, createdAt, new Date(Date.now() + 24 * 60 * 60_000).toISOString())

    await DB.batch([messageStatement, ...attachmentStatements, tokenStatement])
    return 'OK'
  } catch (error) {
    await Promise.allSettled(storedKeys.map(key => ATTACHMENTS.delete(key)))
    throw error
  }
})
