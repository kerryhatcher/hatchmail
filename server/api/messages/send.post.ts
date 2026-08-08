import type { H3Event } from 'h3'
import { readBody } from 'h3'
import { requireSameOrigin, requireUser } from '../../utils/auth'
import { getBindings, nowIso } from '../../utils/cloudflare'
import { getDomainByName, sendMailgunMessage } from '../../utils/mailgun'
import { writeAudit } from '../../utils/audit'

interface AddressRow {
  id: string
  domain_id: string
  local_part: string
  domain_name: string
  can_send: number
}

interface ComposeInput {
  fromAddressId: string
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  text: string
  html: string
  attachments: File[]
}

const EMAIL_LIKE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/

function parseRecipients(value: FormDataEntryValue | string[] | string | undefined): string[] {
  const values = Array.isArray(value) ? value : [typeof value === 'string' ? value : '']
  return values.flatMap(item => item.split(/[;,\n]/)).map(item => item.trim()).filter(Boolean)
}

async function parseCompose(event: H3Event): Promise<ComposeInput> {
  const contentType = event.req.headers.get('content-type') || ''
  if (contentType.includes('multipart/form-data')) {
    const form = await event.req.formData()
    return {
      fromAddressId: String(form.get('fromAddressId') || ''),
      to: parseRecipients(String(form.get('to') || '')),
      cc: parseRecipients(String(form.get('cc') || '')),
      bcc: parseRecipients(String(form.get('bcc') || '')),
      subject: String(form.get('subject') || ''),
      text: String(form.get('text') || ''),
      html: String(form.get('html') || ''),
      attachments: form.getAll('attachment').filter((entry: FormDataEntryValue): entry is File => entry instanceof File),
    }
  }
  const body = await readBody<Record<string, unknown>>(event)
  return {
    fromAddressId: String(body.fromAddressId || ''),
    to: parseRecipients(Array.isArray(body.to) ? body.to.map(String) : String(body.to || '')),
    cc: parseRecipients(Array.isArray(body.cc) ? body.cc.map(String) : String(body.cc || '')),
    bcc: parseRecipients(Array.isArray(body.bcc) ? body.bcc.map(String) : String(body.bcc || '')),
    subject: String(body.subject || ''),
    text: String(body.text || ''),
    html: String(body.html || ''),
    attachments: [],
  }
}

function validateRecipients(recipients: string[]): void {
  if (recipients.some(recipient => !EMAIL_LIKE.test(recipient))) {
    throw createError({ statusCode: 400, statusMessage: 'One or more recipient addresses are invalid' })
  }
}

function safeFilename(name: string): string {
  return (name || 'attachment').replace(/[\\/\u0000-\u001f]/g, '_').trim().slice(0, 240) || 'attachment'
}

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const input = await parseCompose(event)
  if (!input.fromAddressId) throw createError({ statusCode: 400, statusMessage: 'From address is required' })
  if (input.to.length === 0) throw createError({ statusCode: 400, statusMessage: 'At least one recipient is required' })
  if (input.to.length + input.cc.length + input.bcc.length > 100) throw createError({ statusCode: 400, statusMessage: 'Too many recipients' })
  validateRecipients([...input.to, ...input.cc, ...input.bcc])
  if (!input.text && !input.html) throw createError({ statusCode: 400, statusMessage: 'Message body is required' })
  if (input.subject.length > 998) throw createError({ statusCode: 400, statusMessage: 'Subject is too long' })
  if (input.attachments.length > 10) throw createError({ statusCode: 400, statusMessage: 'A maximum of 10 attachments is supported' })
  const totalAttachmentBytes = input.attachments.reduce((sum, file) => sum + file.size, 0)
  if (totalAttachmentBytes > 25 * 1024 * 1024) throw createError({ statusCode: 413, statusMessage: 'Attachments exceed the 25 MiB application limit' })

  const { DB, ATTACHMENTS } = getBindings(event)
  const address = await DB.prepare(`
    SELECT a.id, a.domain_id, a.local_part, d.name AS domain_name, a.can_send
    FROM addresses a JOIN domains d ON d.id = a.domain_id
    WHERE a.id = ? AND a.user_id = ? AND d.active = 1
  `).bind(input.fromAddressId, user.id).first<AddressRow>()
  if (!address || !address.can_send) throw createError({ statusCode: 403, statusMessage: 'You cannot send from that address' })
  const domain = await getDomainByName(event, address.domain_name)
  if (!domain || !domain.active) throw createError({ statusCode: 409, statusMessage: 'Mail domain is inactive' })

  const messageId = crypto.randomUUID()
  const createdAt = nowIso()
  const fromEmail = `${address.local_part}@${address.domain_name}`
  const fromHeader = user.displayName ? `${user.displayName} <${fromEmail}>` : fromEmail
  const storedKeys: string[] = []
  const attachmentRows: Array<{ id: string; key: string; filename: string; type: string; size: number }> = []
  const mailgunForm = new FormData()
  mailgunForm.append('from', fromHeader)
  input.to.forEach(recipient => mailgunForm.append('to', recipient))
  input.cc.forEach(recipient => mailgunForm.append('cc', recipient))
  input.bcc.forEach(recipient => mailgunForm.append('bcc', recipient))
  mailgunForm.append('subject', input.subject)
  if (input.text) mailgunForm.append('text', input.text)
  if (input.html) mailgunForm.append('html', input.html)

  let providerAccepted = false
  try {
    for (const file of input.attachments) {
      const attachmentId = crypto.randomUUID()
      const filename = safeFilename(file.name)
      const bytes = await file.arrayBuffer()
      const key = `messages/${user.id}/${messageId}/${attachmentId}/${filename}`
      await ATTACHMENTS.put(key, bytes, {
        httpMetadata: { contentType: file.type || 'application/octet-stream' },
        customMetadata: { messageId, filename },
      })
      storedKeys.push(key)
      attachmentRows.push({ id: attachmentId, key, filename, type: file.type || 'application/octet-stream', size: bytes.byteLength })
      mailgunForm.append('attachment', new Blob([bytes], { type: file.type || 'application/octet-stream' }), filename)
    }

    await DB.batch([
      DB.prepare(`
        INSERT INTO messages (
          id, user_id, domain_id, address_id, direction, folder, sender, from_header, to_json, cc_json, bcc_json,
          subject, body_text, body_html, headers_json, is_read, created_at
        ) VALUES (?, ?, ?, ?, 'outbound', 'sent', ?, ?, ?, ?, ?, ?, ?, ?, '[]', 1, ?)
      `).bind(
        messageId, user.id, address.domain_id, address.id, fromEmail, fromHeader,
        JSON.stringify(input.to), JSON.stringify(input.cc), JSON.stringify(input.bcc), input.subject, input.text, input.html, createdAt,
      ),
      ...attachmentRows.map(attachment => DB.prepare(`
        INSERT INTO attachments (id, message_id, r2_key, filename, content_type, size, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(attachment.id, messageId, attachment.key, attachment.filename, attachment.type, attachment.size, createdAt)),
    ])

    const result = await sendMailgunMessage(event, domain, mailgunForm)
    providerAccepted = true
    const sentAt = nowIso()
    await DB.prepare('UPDATE messages SET mailgun_id = ?, sent_at = ? WHERE id = ?').bind(result.id || null, sentAt, messageId).run()
    await writeAudit(event, {
      actorUserId: user.id,
      action: 'mail.send',
      targetType: 'message',
      targetId: messageId,
      details: { from: fromEmail, recipientCount: input.to.length + input.cc.length + input.bcc.length },
    })
    return { ok: true, id: messageId, mailgunId: result.id || null }
  } catch (error) {
    if (providerAccepted) {
      console.error('Mailgun accepted message but local finalization failed', { messageId, error })
      return { ok: true, id: messageId, mailgunId: null, warning: 'Message was accepted by Mailgun but local metadata finalization failed' }
    }
    await DB.prepare('DELETE FROM messages WHERE id = ? AND mailgun_id IS NULL').bind(messageId).run().catch(() => undefined)
    await Promise.allSettled(storedKeys.map(key => ATTACHMENTS.delete(key)))
    throw error
  }
})
