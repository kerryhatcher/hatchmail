import { readBody } from 'h3'
import { requireAdmin, requireSameOrigin } from '../../../utils/auth'
import { getBindings, nowIso } from '../../../utils/cloudflare'
import { hashPassword } from '../../../utils/crypto'
import { writeAudit } from '../../../utils/audit'
import { normalizeLocalPart, normalizeUsername, validateLocalPart, validatePassword, validateUsername } from '../../../utils/validation'

interface AddressInput {
  domainId?: string
  localPart?: string
  isPrimary?: boolean
  canSend?: boolean
}

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const admin = await requireAdmin(event)
  const body = await readBody<{
    username?: string
    displayName?: string
    password?: string
    role?: 'user' | 'admin'
    status?: 'active' | 'suspended'
    addresses?: AddressInput[]
  }>(event)
  const username = normalizeUsername(body.username)
  const displayName = String(body.displayName || '').trim()
  const password = body.password || ''
  validateUsername(username)
  validatePassword(password)
  if (!displayName) throw createError({ statusCode: 400, statusMessage: 'Display name is required' })
  const role = body.role === 'admin' ? 'admin' : 'user'
  const status = body.status === 'suspended' ? 'suspended' : 'active'
  const addresses = body.addresses || []
  if (addresses.length > 20) throw createError({ statusCode: 400, statusMessage: 'A user may have at most 20 addresses' })
  for (const address of addresses) {
    if (!address.domainId) throw createError({ statusCode: 400, statusMessage: 'Each address requires a domain' })
    validateLocalPart(normalizeLocalPart(address.localPart))
  }

  const { DB, PASSWORD_PBKDF2_ITERATIONS } = getBindings(event)
  const iterations = Math.max(100_000, Number.parseInt(PASSWORD_PBKDF2_ITERATIONS || '600000', 10) || 600_000)
  const passwordData = await hashPassword(password, iterations)
  const id = crypto.randomUUID()
  const now = nowIso()
  const primaryIndex = Math.max(0, addresses.findIndex(address => address.isPrimary))
  const statements: D1PreparedStatement[] = [
    DB.prepare(`
      INSERT INTO users (id, username, display_name, password_hash, password_salt, password_iterations, role, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, username, displayName, passwordData.hash, passwordData.salt, passwordData.iterations, role, status, now, now),
  ]
  addresses.forEach((address, index) => {
    statements.push(DB.prepare(`
      INSERT INTO addresses (id, user_id, domain_id, local_part, is_primary, can_send, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(), id, address.domainId, normalizeLocalPart(address.localPart), Number(index === primaryIndex), Number(address.canSend !== false), now,
    ))
  })

  try {
    await DB.batch(statements)
  } catch (error) {
    throw createError({ statusCode: 409, statusMessage: 'Username or email address is already in use', cause: error })
  }
  await writeAudit(event, { actorUserId: admin.id, action: 'admin.user.create', targetType: 'user', targetId: id, details: { username, role, status } })
  return { id }
})
