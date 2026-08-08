import type { H3Event } from 'h3'
import { createError, deleteCookie, getCookie, setCookie } from 'h3'
import { getBindings, getClientIp, nowIso } from './cloudflare'
import { randomToken, sha256 } from './crypto'

const SESSION_COOKIE = 'hatchmail_session'

export interface SessionUser {
  id: string
  username: string
  displayName: string
  role: 'user' | 'admin'
  status: 'active' | 'suspended'
}

interface SessionRow {
  id: string
  username: string
  display_name: string
  role: 'user' | 'admin'
  status: 'active' | 'suspended'
  token_hash: string
  expires_at: string
}

export async function createSession(event: H3Event, userId: string): Promise<void> {
  const { DB, SESSION_TTL_DAYS } = getBindings(event)
  const days = Math.max(1, Math.min(30, Number.parseInt(SESSION_TTL_DAYS || '7', 10) || 7))
  const token = randomToken(32)
  const tokenHash = await sha256(token)
  const createdAt = nowIso()
  const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString()

  await DB.prepare(`
    INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at, user_agent, ip_address)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tokenHash,
    userId,
    createdAt,
    createdAt,
    expiresAt,
    event.req.headers.get('user-agent'),
    getClientIp(event),
  ).run()

  setCookie(event, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: days * 86_400,
  })
}

export async function destroySession(event: H3Event): Promise<void> {
  const { DB } = getBindings(event)
  const token = getCookie(event, SESSION_COOKIE)
  if (token) await DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run()
  deleteCookie(event, SESSION_COOKIE, { path: '/' })
}

export async function getCurrentUser(event: H3Event): Promise<SessionUser | null> {
  const token = getCookie(event, SESSION_COOKIE)
  if (!token) return null
  const { DB } = getBindings(event)
  const tokenHash = await sha256(token)
  const row = await DB.prepare(`
    SELECT u.id, u.username, u.display_name, u.role, u.status, s.token_hash, s.expires_at
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?
  `).bind(tokenHash).first<SessionRow>()

  if (!row || row.status !== 'active' || Date.parse(row.expires_at) <= Date.now()) {
    if (row) await DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run()
    deleteCookie(event, SESSION_COOKIE, { path: '/' })
    return null
  }

  const now = nowIso()
  await DB.batch([
    DB.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').bind(now, tokenHash),
    DB.prepare('UPDATE users SET last_active_at = ? WHERE id = ?').bind(now, row.id),
  ])

  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
  }
}

export async function requireUser(event: H3Event): Promise<SessionUser> {
  const user = await getCurrentUser(event)
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  return user
}

export async function requireAdmin(event: H3Event): Promise<SessionUser> {
  const user = await requireUser(event)
  if (user.role !== 'admin') throw createError({ statusCode: 403, statusMessage: 'Administrator access required' })
  return user
}

export function requireSameOrigin(event: H3Event): void {
  const method = event.req.method.toUpperCase()
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return
  const origin = event.req.headers.get('origin')
  if (!origin) return
  const expected = new URL(event.req.url).origin
  if (origin !== expected) throw createError({ statusCode: 403, statusMessage: 'Invalid request origin' })
}
