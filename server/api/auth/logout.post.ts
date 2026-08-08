import { destroySession, getCurrentUser } from '../../utils/auth'
import { writeAudit } from '../../utils/audit'

export default defineEventHandler(async (event) => {
  const user = await getCurrentUser(event)
  if (user) await writeAudit(event, { actorUserId: user.id, action: 'auth.logout', targetType: 'user', targetId: user.id })
  await destroySession(event)
  return { ok: true }
})
