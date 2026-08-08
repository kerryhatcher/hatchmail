import { readBody } from 'h3'
import { createSession } from '../../utils/auth'
import { getBindings } from '../../utils/cloudflare'
import { verifyPassword } from '../../utils/crypto'
import { writeAudit } from '../../utils/audit'

interface UserRow {
  id: string
  username: string
  display_name: string
  password_hash: string
  password_salt: string
  password_iterations: number
  role: 'user' | 'admin'
  status: 'active' | 'suspended'
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{ username?: string; password?: string }>(event)
  const username = (body.username || '').trim().toLowerCase()
  const password = body.password || ''
  if (!username || !password) throw createError({ statusCode: 400, statusMessage: 'Username and password are required' })

  const { DB } = getBindings(event)
  const user = await DB.prepare(`
    SELECT id, username, display_name, password_hash, password_salt, password_iterations, role, status
    FROM users WHERE username = ? COLLATE NOCASE
  `).bind(username).first<UserRow>()

  const valid = user && user.status === 'active'
    ? await verifyPassword(password, user.password_hash, user.password_salt, user.password_iterations)
    : false
  if (!user || !valid) throw createError({ statusCode: 401, statusMessage: 'Invalid username or password' })

  await createSession(event, user.id)
  await writeAudit(event, { actorUserId: user.id, action: 'auth.login', targetType: 'user', targetId: user.id })
  return {
    user: {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
      status: user.status,
    },
  }
})
