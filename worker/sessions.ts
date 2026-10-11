// pwa-kit: auth/functions/sessions.ts v6
// Server-issued session tokens in D1, adapted from the kit: this app has one
// user, so a session row needs no user column. 90 days, revocable by deleting
// the row. The X tokens are a separate thing and never reach the client.

export async function createSession(db: D1Database): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const token = 'sess_' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  await db.batch([
    db.prepare(`DELETE FROM sessions WHERE expires_at < datetime('now')`),
    db.prepare(`INSERT INTO sessions (token, expires_at) VALUES (?1, datetime('now', '+90 days'))`).bind(token),
  ])
  return token
}

export async function validateSession(db: D1Database, token: string | undefined): Promise<boolean> {
  if (!token?.startsWith('sess_')) return false
  try {
    const row = await db
      .prepare(`SELECT 1 AS ok FROM sessions WHERE token = ?1 AND expires_at > datetime('now')`)
      .bind(token)
      .first()
    return !!row
  } catch {
    return false
  }
}

export async function deleteSession(db: D1Database, token: string | undefined): Promise<void> {
  if (!token?.startsWith('sess_')) return
  try {
    await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run()
  } catch {}
}

export function bearer(request: Request): string | undefined {
  const h = request.headers.get('Authorization') || ''
  return h.startsWith('Bearer ') ? h.slice(7) : undefined
}
