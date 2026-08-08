import { getRouterParam, readBody } from 'h3'
import { requireAdmin, requireSameOrigin } from '../../../utils/auth'
import { getBindings, nowIso } from '../../../utils/cloudflare'
import { hashPassword } from '../../../utils/crypto'
import { writeAudit } from '../../../utils/audit'
import { normalizeLocalPart, normalizeUsername, validateLocalPart, validatePassword, validateUsername } from '../../../utils/validation'

interface AddressInput {
  id?: string
  domainId?: string
  localPart?: string
  isPrimary?: boolean
  canSend?: boolean
}

interface ExistingUser {
  id: string
  username: string
  display_name: string
  role: 'user' | 'admin'
  status: 'active' | 'suspended'
}

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const admin = await requireAdmin(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'User id is required' })
  const { DB, PASSWORD_PBKDF2_ITERATIONS } = getBindings(event)
  const existing = await DB.prepare('SELECT id, username, display_name, role, status FROM users WHERE id = ?').bind(id).first<ExistingUser>()
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'User not found' })

  const body = await readBody<{
    username?: string
    displayName?: string
    password?: string
    role?: 'user' | 'admin'
    status?: 'active' | 'suspended'
    addresses?: AddressInput[]
  }>(event)
  const username = body.username === undefined ? existing.username : normalizeUsername(body.username)
  const displayName = body.displayName === undefined ? existing.display_name : String(body.displayName).trim()
  const role = body.role === undefined ? existing.role : body.role
  const status = body.status === undefined ? existing.status : body.status
  validateUsername(username)
  if (!displayName) throw createError({ statusCode: 400, statusMessage: 'Display name is required' })
  if (!['user', 'admin'].includes(role)) throw createError({ statusCode: 400, statusMessage: 'Invalid role' })
  if (!['active', 'suspended'].includes(status)) throw createError({ statusCode: 400, statusMessage: 'Invalid status' })
  if (id === admin.id && (role !== 'admin' || status !== 'active')) {
    throw createError({ statusCode: 400, statusMessage: 'You cannot remove your own active administrator access' })
  }
  if (body.password) validatePassword(body.password)
  if (body.addresses && body.addresses.length > 20) throw createError({ statusCode: 400, statusMessage: 'A user may have at most 20 addresses' })
  for (const address of body.addresses || []) {
    if (!address.domainId) throw createError({ statusCode: 400, statusMessage: 'Each address requires a domain' })
    validateLocalPart(normalizeLocalPart(address.localPart))
  }

  const now = nowIso()
  const statements: D1PreparedStatement[] = []
  if (body.password) {
    const iterations = Math.max(100_000, Number.parseInt(PASSWORD_PBKDF2_ITERATIONS || '600000', 10) || 600_000)
    const passwordData = await hashPassword(body.password, iterations)
    statements.push(DB.prepare(`
      UPDATE users SET username = ?, display_name = ?, role = ?, status = ?, password_hash = ?, password_salt = ?, password_iterations = ?, updated_at = ?
      WHERE id = ?
    `).bind(username, displayName, role, status, passwordData.hash, passwordData.salt, passwordData.iterations, now, id))
  } else {
    statements.push(DB.prepare('UPDATE users SET username = ?, display_name = ?, role = ?, status = ?, updated_at = ? WHERE id = ?')
      .bind(username, displayName, role, status, now, id))
  }

  if (body.addresses) {
    statements.push(DB.prepare('DELETE FROM addresses WHERE user_id = ?').bind(id))
    const primaryIndex = Math.max(0, body.addresses.findIndex(address => address.isPrimary))
    body.addresses.forEach((address, index) => {
      statements.push(DB.prepare(`
        INSERT INTO addresses (id, user_id, domain_id, local_part, is_primary, can_send, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(), id, address.domainId, normalizeLocalPart(address.localPart), Number(index === primaryIndex), Number(address.canSend !== false), now,
      ))
    })
  }

  try {
    await DB.batch(statements)
  } catch (error) {
    throw createError({ statusCode: 409, statusMessage: 'Username or email address is already in use', cause: error })
  }
  if (status === 'suspended') await DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run()
  await writeAudit(event, { actorUserId: admin.id, action: 'admin.user.update', targetType: 'user', targetId: id, details: { username, role, status } })
  return { ok: true }
})
