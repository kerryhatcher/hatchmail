import { readBody } from 'h3'
import { createSession } from '../utils/auth'
import { getBindings, nowIso } from '../utils/cloudflare'
import { hashPassword, timingSafeEqual } from '../utils/crypto'
import { writeAudit } from '../utils/audit'

interface SetupBody {
  bootstrapToken?: string
  username?: string
  displayName?: string
  password?: string
}

export default defineEventHandler(async (event) => {
  const { DB, BOOTSTRAP_TOKEN, PASSWORD_PBKDF2_ITERATIONS } = getBindings(event)
  const existing = await DB.prepare('SELECT COUNT(*) AS count FROM users').first<{ count: number }>()
  if ((existing?.count ?? 0) > 0) throw createError({ statusCode: 409, statusMessage: 'Hatchmail has already been initialized' })
  if (!BOOTSTRAP_TOKEN) throw createError({ statusCode: 503, statusMessage: 'BOOTSTRAP_TOKEN is not configured' })

  const body = await readBody<SetupBody>(event)
  if (!body.bootstrapToken || !timingSafeEqual(body.bootstrapToken, BOOTSTRAP_TOKEN)) {
    throw createError({ statusCode: 403, statusMessage: 'Invalid bootstrap token' })
  }

  const username = (body.username || '').trim().toLowerCase()
  const displayName = (body.displayName || '').trim()
  const password = body.password || ''
  if (!/^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$/.test(username)) {
    throw createError({ statusCode: 400, statusMessage: 'Username must be 3-64 characters using letters, numbers, dot, underscore, or hyphen' })
  }
  if (!displayName) throw createError({ statusCode: 400, statusMessage: 'Display name is required' })
  if (password.length < 12) throw createError({ statusCode: 400, statusMessage: 'Password must be at least 12 characters' })

  const iterations = Math.max(100_000, Number.parseInt(PASSWORD_PBKDF2_ITERATIONS || '600000', 10) || 600_000)
  const passwordData = await hashPassword(password, iterations)
  const id = crypto.randomUUID()
  const now = nowIso()

  await DB.prepare(`
    INSERT INTO users (id, username, display_name, password_hash, password_salt, password_iterations, role, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'admin', 'active', ?, ?)
  `).bind(id, username, displayName, passwordData.hash, passwordData.salt, passwordData.iterations, now, now).run()

  await createSession(event, id)
  await writeAudit(event, { actorUserId: id, action: 'system.bootstrap', targetType: 'user', targetId: id })

  return { user: { id, username, displayName, role: 'admin', status: 'active' } }
})
