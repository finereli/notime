import type { Env } from './env'
import type { X, XPost, XUser } from './x'
import { PUSH_BY_DEFAULT, mentionNotification, parseEvent, pushText, type Notification } from './events'
import { fanOut } from './push'
import { bump } from './usage'

export async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare(`SELECT value FROM settings WHERE key = ?1`).bind(key).first<{ value: string }>()
  return row?.value ?? null
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db.prepare(`INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2`).bind(key, value).run()
}

export async function saveUsers(db: D1Database, users: XUser[]): Promise<void> {
  if (!users.length) return
  await db.batch(
    users.map((u) =>
      db
        .prepare(`INSERT INTO x_users (id, username, name, avatar) VALUES (?1, ?2, ?3, ?4)
                  ON CONFLICT(id) DO UPDATE SET username = ?2, name = ?3, avatar = COALESCE(?4, avatar)`)
        .bind(u.id, u.username, u.name, u.profile_image_url ?? null),
    ),
  )
}

export async function savePosts(db: D1Database, posts: XPost[]): Promise<void> {
  if (!posts.length) return
  await db.batch(
    posts.map((p) =>
      db
        .prepare(`INSERT INTO x_posts (id, author_id, text, created_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(id) DO NOTHING`)
        .bind(p.id, p.author_id ?? null, p.text, p.created_at ?? null),
    ),
  )
}

// Returns true only when the row is new, which is what decides a push.
export async function insertNotification(db: D1Database, n: Notification, raw: unknown, read = 0): Promise<boolean> {
  const r = await db
    .prepare(`INSERT OR IGNORE INTO notifications (id, type, actor_id, post_id, target_post_id, text, created_at, read, raw)
              VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`)
    .bind(n.id, n.type, n.actor_id, n.post_id, n.target_post_id, n.text, n.created_at, read, raw ? JSON.stringify(raw) : null)
    .run()
  return (r.meta.changes ?? 0) > 0
}

export const unreadCount = async (db: D1Database): Promise<number> =>
  (await db.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE read = 0`).first<{ n: number }>())?.n ?? 0

const LIST_SQL = `
  SELECT n.id, n.type, n.actor_id, n.post_id, n.target_post_id, n.text, n.created_at, n.read, n.replied_post_id,
         u.username, u.name, u.avatar, p.text AS target_text
  FROM notifications n
  LEFT JOIN x_users u ON u.id = n.actor_id
  LEFT JOIN x_posts p ON p.id = n.target_post_id`

export async function listNotifications(db: D1Database, before: string | null, limit: number) {
  const { results } = await db
    .prepare(`${LIST_SQL} WHERE (?1 IS NULL OR n.created_at < ?1) ORDER BY n.created_at DESC LIMIT ?2`)
    .bind(before, limit)
    .all()
  return results
}

export const getNotification = (db: D1Database, id: string) =>
  db.prepare(`${LIST_SQL} WHERE n.id = ?1`).bind(id).first<Record<string, any>>()

// Fill in the author, and the post being answered, when X left them out of
// the event. Each lookup is paid for once and then kept.
export async function hydrate(env: Env, x: X, token: string, n: { actor_id: string; target_post_id: string | null; type: string }) {
  const db = env.DB
  const known = await db.prepare(`SELECT 1 AS ok FROM x_users WHERE id = ?1`).bind(n.actor_id).first()
  if (!known) {
    const u = await x.getUser(token, n.actor_id).catch(() => null)
    if (u) await saveUsers(db, [u])
  }
  if (n.target_post_id && (n.type === 'reply' || n.type === 'quote' || n.type === 'like' || n.type === 'repost')) {
    const have = await db.prepare(`SELECT 1 AS ok FROM x_posts WHERE id = ?1`).bind(n.target_post_id).first()
    if (!have) {
      const p = await x.getPost(token, n.target_post_id).catch(() => null)
      if (p) await savePosts(db, [p])
    }
  }
}

export async function ingestEvent(env: Env, x: X, getToken: () => Promise<string>, event: any, ownerId: string): Promise<void> {
  const db = env.DB
  const uuid = event?.event_uuid ? String(event.event_uuid) : null
  if (uuid) {
    const fresh = await db.prepare(`INSERT OR IGNORE INTO events_seen (uuid) VALUES (?1)`).bind(uuid).run()
    if (!fresh.meta.changes) return
  }
  const parsed = parseEvent(event, ownerId)
  if (parsed.billed) await bump(db, parsed.billed)
  await setSetting(db, 'last_event_at', new Date().toISOString())
  await saveUsers(db, parsed.users)
  await savePosts(db, parsed.posts)
  const n = parsed.notification
  if (!n) return
  if (!(await insertNotification(db, n, event))) return

  const pushAll = (await getSetting(db, 'push_all')) === '1'
  if (!pushAll && !PUSH_BY_DEFAULT.includes(n.type)) return
  try {
    await hydrate(env, x, await getToken(), n)
  } catch {}
  await pushFor(env, n.id)
}

export async function pushFor(env: Env, id: string): Promise<void> {
  const row = await getNotification(env.DB, id)
  if (!row) return
  const who = row.name || (row.username ? '@' + row.username : 'Someone')
  const { title, body } = pushText(row.type, who, row.text, row.target_text)
  const openable = row.type === 'reply' || row.type === 'mention' || row.type === 'quote'
  await fanOut(env.DB, { title, body, tag: id, url: openable ? `/#/n/${encodeURIComponent(id)}` : '/#/notifications', unread: await unreadCount(env.DB) }, env)
}

// The safety net under the webhook: read the owner's mentions since the last
// one we saw. An owned read, so a tenth of a cent per post.
export async function backfill(env: Env, x: X, token: string, ownerId: string): Promise<number> {
  const db = env.DB
  const since = await getSetting(db, 'mentions_since')
  const page = await x.mentions(token, ownerId, since ?? undefined)
  await saveUsers(db, page.users)
  await savePosts(db, page.parents)
  let added = 0
  for (const post of page.posts) {
    const n = mentionNotification(post, ownerId)
    if (n && (await insertNotification(db, n, null))) added++
  }
  const newest = page.newestId ?? page.posts[0]?.id
  if (newest) await setSetting(db, 'mentions_since', newest)
  return added
}
