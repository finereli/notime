import type { Env } from './env'
import type { X, XPost, XUser } from './x'
import { cleanPosts, mentionNotification, parseEvent, pushText, type Dm, type Notification } from './events'
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
        // Later sightings can only add to what we know: the full text of a
        // long post, or what the post was answering.
        .prepare(`INSERT INTO x_posts (id, author_id, text, created_at, reply_to) VALUES (?1, ?2, ?3, ?4, ?5)
                  ON CONFLICT(id) DO UPDATE SET
                    text = CASE WHEN length(?3) > length(COALESCE(text, '')) THEN ?3 ELSE text END,
                    author_id = COALESCE(author_id, ?2), created_at = COALESCE(created_at, ?4), reply_to = COALESCE(reply_to, ?5)`)
        .bind(p.id, p.author_id ?? null, p.text, p.created_at ?? null, p.reply_to ?? null),
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

export const KINDS = `('reply', 'mention', 'quote')`

export const unreadCount = async (db: D1Database): Promise<number> =>
  (await db.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE read = 0 AND type IN ${KINDS}`).first<{ n: number }>())?.n ?? 0

// prev_id links a reply to the earlier notification it continues: they
// answered the owner's post, which answered that one. answered is true when
// any post of the owner's answers this one, from here or from X itself.
const LIST_SQL = `
  SELECT n.id, n.type, n.actor_id, n.post_id, n.target_post_id, n.text, n.created_at, n.read, n.replied_post_id, n.liked,
         u.username, u.name, u.avatar, p.text AS target_text,
         (SELECT m.id FROM notifications m WHERE m.post_id = p.reply_to AND p.reply_to != '' LIMIT 1) AS prev_id,
         (n.replied_post_id IS NOT NULL OR EXISTS (SELECT 1 FROM x_posts o WHERE o.reply_to = n.post_id AND o.author_id = (SELECT x_user_id FROM account WHERE id = 1))) AS answered
  FROM notifications n
  LEFT JOIN x_users u ON u.id = n.actor_id
  LEFT JOIN x_posts p ON p.id = n.target_post_id`

export async function listNotifications(db: D1Database, before: string | null, limit: number) {
  const { results } = await db
    .prepare(`${LIST_SQL} WHERE n.type IN ${KINDS} AND (?1 IS NULL OR n.created_at < ?1) ORDER BY n.created_at DESC LIMIT ?2`)
    .bind(before, limit)
    .all()
  return results.map(clean)
}

const clean = (r: Record<string, any>): Record<string, any> => ({ ...r, answered: !!r.answered, liked: !!r.liked })

export async function getNotification(db: D1Database, id: string) {
  const r = await db.prepare(`${LIST_SQL} WHERE n.id = ?1`).bind(id).first<Record<string, any>>()
  return r ? clean(r) : null
}

// The conversation leading up to a notification, oldest first: each earlier
// reply in the chain, as far back as we have them.
export async function chainOf(db: D1Database, row: Record<string, any>) {
  const chain: Record<string, any>[] = []
  const seen = new Set<string>([row.id])
  let prev = row.prev_id as string | null
  while (prev && !seen.has(prev) && chain.length < 30) {
    seen.add(prev)
    const r = await getNotification(db, prev)
    if (!r) break
    chain.unshift(r)
    prev = r.prev_id
  }
  return chain
}

// Fill in the author, and the post being answered, when X left them out of
// the event. Each lookup is paid for once and then kept.
export async function hydrate(env: Env, x: X, token: string, n: { actor_id: string; target_post_id: string | null; type: string }) {
  const db = env.DB
  const known = await db.prepare(`SELECT 1 AS ok FROM x_users WHERE id = ?1`).bind(n.actor_id).first()
  if (!known) {
    const u = await x.getUser(token, n.actor_id).catch(() => null)
    if (u) await saveUsers(db, [u])
  }
  if (n.target_post_id && (n.type === 'reply' || n.type === 'quote')) {
    // Also look the post up when we hold it but not what it answered: that
    // is what ties a back-and-forth together.
    const have = await db.prepare(`SELECT reply_to FROM x_posts WHERE id = ?1`).bind(n.target_post_id).first<{ reply_to: string | null }>()
    if (!have || have.reply_to === null) {
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
  if (parsed.dm) {
    if ((await saveDm(db, parsed.dm, ownerId)) && parsed.dm.sender_id !== ownerId) await pushDm(env, parsed.dm)
    return
  }
  const n = parsed.notification
  if (!n) return
  if (!(await insertNotification(db, n, event))) return
  try {
    await hydrate(env, x, await getToken(), n)
  } catch {}
  await pushFor(env, n.id)
}

export async function badge(db: D1Database): Promise<number> {
  return (await unreadCount(db)) + (await unreadDms(db))
}

export async function pushFor(env: Env, id: string): Promise<void> {
  const row = await getNotification(env.DB, id)
  if (!row) return
  const who = row.name || (row.username ? '@' + row.username : 'Someone')
  const { title, body } = pushText(row.type, who, row.text)
  await fanOut(env.DB, { title, body, tag: id, url: `/#/n/${encodeURIComponent(id)}`, unread: await badge(env.DB) }, env)
}

// --- direct messages ---------------------------------------------------------

// A message we sent is read by definition. Returns true only when it is new.
export async function saveDm(db: D1Database, m: Dm, ownerId: string): Promise<boolean> {
  const r = await db
    .prepare(`INSERT OR IGNORE INTO dms (id, conversation_id, partner_id, sender_id, text, created_at, read) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`)
    .bind(m.id, m.conversation_id, m.partner_id, m.sender_id, m.text, m.created_at, m.sender_id === ownerId ? 1 : 0)
    .run()
  const fresh = (r.meta.changes ?? 0) > 0
  // Answering, here or anywhere else, means what came before has been read.
  if (fresh && m.sender_id === ownerId) await db.prepare(`UPDATE dms SET read = 1 WHERE partner_id = ?1 AND created_at <= ?2`).bind(m.partner_id, m.created_at).run()
  return fresh
}

export const unreadDms = async (db: D1Database): Promise<number> =>
  (await db.prepare(`SELECT COUNT(DISTINCT partner_id) AS n FROM dms WHERE read = 0`).first<{ n: number }>())?.n ?? 0

async function pushDm(env: Env, m: Dm): Promise<void> {
  const u = await env.DB.prepare(`SELECT username, name FROM x_users WHERE id = ?1`).bind(m.partner_id).first<{ username: string; name: string }>()
  const who = u?.name || (u?.username ? '@' + u.username : 'Someone')
  await fanOut(env.DB, { title: who, body: m.text.slice(0, 240), tag: 'dm:' + m.partner_id, url: `/#/m/${m.partner_id}`, unread: await badge(env.DB) }, env)
}

// One row per person: the latest message and how many are unread.
export async function listConversations(db: D1Database) {
  const { results } = await db
    .prepare(`SELECT d.partner_id, d.text, d.sender_id, d.created_at,
                     (SELECT COUNT(*) FROM dms r WHERE r.partner_id = d.partner_id AND r.read = 0) AS unread,
                     u.username, u.name, u.avatar
              FROM dms d
              LEFT JOIN x_users u ON u.id = d.partner_id
              WHERE d.id = (SELECT id FROM dms l WHERE l.partner_id = d.partner_id ORDER BY l.created_at DESC, l.id DESC LIMIT 1)
              ORDER BY d.created_at DESC`)
    .all()
  return results
}

export async function listMessages(db: D1Database, partnerId: string) {
  const { results } = await db
    .prepare(`SELECT id, sender_id, text, created_at FROM dms WHERE partner_id = ?1 ORDER BY created_at DESC, id DESC LIMIT 200`)
    .bind(partnerId)
    .all()
  return results.reverse()
}

// The safety net and the first fill: ask X for recent messages. A cent each,
// so only on request.
export async function syncDms(env: Env, x: X, token: string, ownerId: string, partnerId?: string): Promise<number> {
  const db = env.DB
  const page = await x.dms(token, ownerId, { partnerId, max: partnerId ? 50 : 100 })
  await saveUsers(db, page.users)
  let added = 0
  for (const m of page.dms) if (await saveDm(db, m, ownerId)) added++
  await setSetting(db, 'dms_synced', new Date().toISOString())
  return added
}

// --- what X really charged ---------------------------------------------------

// Spend is read off the balance: every drop between two readings is money
// spent; a rise is a top-up and is not counted.
export async function realSpend(env: Env, x: X, token: string) {
  const db = env.DB
  const credits = await x.credits(token).catch(() => null)
  if (credits) {
    const day = new Date().toISOString().slice(0, 10)
    await db
      .prepare(`INSERT INTO balance (day, total) VALUES (?1, ?2) ON CONFLICT(day) DO UPDATE SET total = ?2, at = datetime('now')`)
      .bind(day, credits.total)
      .run()
  }
  const month = new Date().toISOString().slice(0, 7)
  const { results } = await db
    .prepare(`SELECT day, total FROM balance WHERE day >= (SELECT COALESCE(MAX(day), '0') FROM balance WHERE day < ?1) ORDER BY day`)
    .bind(month + '-01')
    .all<{ day: string; total: number }>()
  let spent = 0
  for (let i = 1; i < results.length; i++) spent += Math.max(0, results[i - 1].total - results[i].total)
  return { credits, spent, since: results[0]?.day ?? null }
}

// The safety net under the webhook: read the owner's mentions since the last
// one we saw. An owned read, so a tenth of a cent per post.
export async function backfill(env: Env, x: X, token: string, ownerId: string): Promise<number> {
  const db = env.DB
  const since = await getSetting(db, 'mentions_since')
  const page = await x.mentions(token, ownerId, since ?? undefined)
  await saveUsers(db, page.users)
  await savePosts(db, [...page.parents, ...cleanPosts(page.posts)])
  let added = 0
  for (const post of page.posts) {
    const n = mentionNotification(post, ownerId)
    if (n && (await insertNotification(db, n, null))) added++
  }
  const newest = page.newestId ?? page.posts[0]?.id
  if (newest) await setSetting(db, 'mentions_since', newest)
  return added
}

// --- the owner's own posts ---------------------------------------------------
// Posts made through the app are stored as they are made, which is free. The
// sync below fills in the ones made elsewhere. Snowflake ids sort by time, so
// the id is the order.

export async function listOwnPosts(db: D1Database, ownerId: string, before: string | null, limit: number) {
  const oldest = await getSetting(db, 'posts_oldest')
  const { results } = await db
    .prepare(`SELECT id, text, created_at FROM x_posts
              WHERE author_id = ?1 AND CAST(id AS INTEGER) >= CAST(?2 AS INTEGER) AND (?3 IS NULL OR CAST(id AS INTEGER) < CAST(?3 AS INTEGER))
              ORDER BY CAST(id AS INTEGER) DESC LIMIT ?4`)
    .bind(ownerId, oldest ?? '0', before, limit)
    .all<{ id: string; text: string; created_at: string | null }>()
  return { items: results, synced: oldest !== null }
}

export async function syncOwnPosts(env: Env, x: X, token: string, ownerId: string, older: boolean): Promise<number> {
  const db = env.DB
  const oldest = await getSetting(db, 'posts_oldest')
  const range: { sinceId?: string; untilId?: string } = {}
  if (oldest && older) range.untilId = oldest
  else if (oldest) {
    const newest = await db
      .prepare(`SELECT id FROM x_posts WHERE author_id = ?1 ORDER BY CAST(id AS INTEGER) DESC LIMIT 1`)
      .bind(ownerId)
      .first<{ id: string }>()
    if (newest) range.sinceId = newest.id
  }
  const page = await x.myPosts(token, ownerId, range)
  await savePosts(db, page.posts)
  const ids = page.posts.map((p) => BigInt(p.id))
  if (oldest) ids.push(BigInt(oldest))
  if (ids.length) await setSetting(db, 'posts_oldest', String(ids.reduce((a, b) => (b < a ? b : a))))
  else if (!oldest) await setSetting(db, 'posts_oldest', '0')
  return page.posts.length
}
