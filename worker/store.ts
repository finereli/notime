import type { Env } from './env'
import type { X, XPost, XUser } from './x'
import { cleanPosts, decode, mentionNotification, parseEvent, pushText, type Dm, type Notification } from './events'
import { fanOut } from './web-push'
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
        .prepare(`INSERT INTO x_posts (id, author_id, text, created_at, reply_to, extra) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                  ON CONFLICT(id) DO UPDATE SET
                    text = CASE WHEN length(?3) > length(COALESCE(text, '')) THEN ?3 ELSE text END,
                    author_id = COALESCE(author_id, ?2), created_at = COALESCE(created_at, ?4), reply_to = COALESCE(reply_to, ?5),
                    extra = COALESCE(?6, extra)`)
        .bind(p.id, p.author_id ?? null, p.text, p.created_at ?? null, p.reply_to ?? null, p.extra ? JSON.stringify(p.extra) : null),
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
         (SELECT x.extra FROM x_posts x WHERE x.id = n.post_id) AS extra, p.extra AS target_extra,
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
  // Interleave the cumulative lines by their latest like or follow, then cut
  // the page; the next page starts below the last line shown.
  const merged = [...results.map(clean), ...(await activityLines(db, before, limit))]
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
  return { items: merged.slice(0, limit), more: results.length === limit || merged.length > limit }
}

// Like counts for the owner's latest posts, read from X at most every half
// hour, and only when someone is looking. A tenth of a cent per post, and X
// charges a post once per UTC day, so about a cent a day however many likes
// arrive. Billed like events cost that per like.
export async function syncStats(env: Env, x: X, token: string, ownerId: string, force = false) {
  const db = env.DB
  const last = await getSetting(db, 'stats_at')
  if (!force && last && Date.now() - Date.parse(last) < 30 * 60_000) return
  await setSetting(db, 'stats_at', new Date().toISOString())
  const { posts, likes } = await x.myStats(token, ownerId)
  await savePosts(db, posts)
  const now = new Date().toISOString()
  // A post seen for the first time sits at its own time, not at the top.
  await db.batch(
    posts.map((p) =>
      db
        .prepare(`INSERT INTO post_stats (post_id, likes, changed_at) VALUES (?1, ?2, ?3)
                  ON CONFLICT(post_id) DO UPDATE SET changed_at = CASE WHEN ?2 > likes THEN ?4 ELSE changed_at END, likes = ?2`)
        .bind(p.id, likes[p.id] ?? 0, p.created_at ?? now, now),
    ),
  )
}

// One line per liked post (its count) and one for followers (the count and
// the latest two names), each placed by when it last grew.
async function activityLines(db: D1Database, before: string | null, limit: number) {
  const seen = (await getSetting(db, 'activity_seen_at')) ?? ''
  const { results: groups } = await db
    .prepare(`SELECT 'follow' AS kind, '' AS post_id, COUNT(*) AS n, MAX(at) AS at FROM activity WHERE kind = 'follow'
              HAVING COUNT(*) > 0 AND (?1 IS NULL OR MAX(at) < ?1)
              UNION ALL
              SELECT 'like', post_id, likes, changed_at FROM post_stats WHERE likes > 0 AND (?1 IS NULL OR changed_at < ?1)
              ORDER BY at DESC LIMIT ?2`)
    .bind(before, limit)
    .all<{ kind: string; post_id: string; n: number; at: string }>()
  if (!groups.length) return []
  const latest = await db.batch(
    groups.map((g) =>
      db
        .prepare(`SELECT a.actor_id, u.username, u.name, u.avatar FROM activity a LEFT JOIN x_users u ON u.id = a.actor_id
                  WHERE a.kind = ?1 AND a.post_id = ?2 ORDER BY a.at DESC LIMIT 2`)
        .bind(g.kind, g.post_id),
    ),
  )
  const posts = await db.batch(groups.map((g) => db.prepare(`SELECT text, extra FROM x_posts WHERE id = ?1`).bind(g.post_id)))
  return groups.map((g, i) => {
    const [first, second] = (latest[i].results ?? []) as Array<Record<string, any>>
    const liked = g.kind === 'like'
    return {
      id: liked ? `likes:${g.post_id}` : 'follows',
      type: liked ? 'likes' : 'follows',
      actor_id: first?.actor_id ?? '',
      post_id: liked ? g.post_id : null,
      target_post_id: liked ? g.post_id : null,
      text: null,
      created_at: g.at,
      read: g.at <= seen ? 1 : 0,
      replied_post_id: null,
      username: first?.username ?? null,
      name: first?.name ?? null,
      avatar: first?.avatar ?? null,
      target_text: liked ? ((posts[i].results?.[0] as any)?.text ?? null) : null,
      target_extra: liked ? parseExtra((posts[i].results?.[0] as any)?.extra) : null,
      count: g.n,
      second: second ? second.name || (second.username ? '@' + second.username : null) : null,
    } as Record<string, any>
  })
}

export const parseExtra = (v: unknown) => {
  if (typeof v !== 'string') return v ?? null
  try { return JSON.parse(v) } catch { return null }
}

const clean = (r: Record<string, any>): Record<string, any> => ({ ...r, answered: !!r.answered, liked: !!r.liked, extra: parseExtra(r.extra), target_extra: parseExtra(r.target_extra) })

// One post with its author, from our cache, else from X once (half a cent).
// A cached post that has links but no extras yet is looked up once more;
// '{}' records that X had nothing to add, so it is never asked twice.
export async function lookPost(env: Env, x: X, token: () => Promise<string>, id: string) {
  const db = env.DB
  const find = () =>
    db
      .prepare(`SELECT p.id, p.text, p.created_at, p.author_id, p.extra, u.username, u.name, u.avatar
                FROM x_posts p LEFT JOIN x_users u ON u.id = p.author_id WHERE p.id = ?1`)
      .bind(id)
      .first<Record<string, any>>()
  let row = await find()
  if (!row || !row.author_id || (row.extra === null && /t\.co\//.test(row.text ?? '')) || (row.author_id && !row.username)) {
    const p = await x.getPost(await token(), id).catch(() => null)
    if (p) {
      await savePosts(db, [{ ...p, extra: p.extra ?? {} }])
      if (p.author) await saveUsers(db, [p.author])
    }
    row = await find()
  }
  return row ? ({ ...row, extra: parseExtra(row.extra) } as Record<string, any>) : null
}

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

// For a reply to someone else further down the owner's thread: the posts
// above it, oldest first, back to the owner's own. Posts we have not seen are
// looked up once (half a cent each) and kept.
export async function threadOf(env: Env, x: X, token: () => Promise<string>, row: Record<string, any>, ownerId: string) {
  const db = env.DB
  if (row.type !== 'mention' || !row.post_id) return []
  const out: Record<string, any>[] = []
  const seen = new Set<string>()
  let cur = (await db.prepare(`SELECT reply_to FROM x_posts WHERE id = ?1`).bind(row.post_id).first<{ reply_to: string | null }>())?.reply_to ?? null
  while (cur && !seen.has(cur) && out.length < 6) {
    seen.add(cur)
    const get = () => db
      .prepare(`SELECT p.id, p.author_id, p.text, p.created_at, p.reply_to, p.extra, u.username, u.name, u.avatar FROM x_posts p LEFT JOIN x_users u ON u.id = p.author_id WHERE p.id = ?1`)
      .bind(cur).first<Record<string, any>>()
    let p = await get()
    if (!p || !p.username) {
      const fetched = await x.getPost(await token(), cur).catch(() => null)
      if (fetched) await savePosts(db, [fetched])
      if (fetched?.author) await saveUsers(db, [fetched.author])
      p = await get()
    }
    if (!p) break
    out.unshift({ ...p, extra: parseExtra(p.extra), mine: p.author_id === ownerId })
    if (p.author_id === ownerId) break
    cur = p.reply_to || null
  }
  return out
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
      if (p?.author) await saveUsers(db, [p.author])
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
  if (parsed.activity) {
    // Never a push: worth seeing, nothing to answer.
    const a = parsed.activity
    await db.prepare(`INSERT OR IGNORE INTO activity (kind, post_id, actor_id, at) VALUES (?1, ?2, ?3, ?4)`).bind(a.kind, a.post_id, a.actor_id, a.at).run()
    return
  }
  if (parsed.liked) {
    await db.prepare(`UPDATE notifications SET liked = 1, read = 1 WHERE post_id = ?1`).bind(parsed.liked).run()
    return
  }
  if (parsed.dm) {
    if ((await saveDm(db, parsed.dm, ownerId)) && parsed.dm.sender_id !== ownerId) await pushDm(env, parsed.dm)
    return
  }
  const n = parsed.notification
  if (!n) return
  if (!(await insertNotification(db, n, event))) return
  // Every delivery costs, so this is where the balance moves. Glance at it
  // at most once an hour.
  await checkBalance(env, x, await getToken(), 3600_000).catch(() => {})
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

// Hearts given on X before the like events were flowing. A tenth of a cent
// per like read, so only once, at sign in.
export async function syncLikes(env: Env, x: X, token: string, ownerId: string): Promise<number> {
  const ids = await x.likedPosts(token, ownerId)
  if (!ids.length) return 0
  const marks = ids.map((id) => env.DB.prepare(`UPDATE notifications SET liked = 1 WHERE post_id = ?1 AND liked = 0`).bind(id))
  const results = await env.DB.batch(marks)
  return results.reduce((n, r) => n + (r.meta.changes ?? 0), 0)
}

// --- direct messages ---------------------------------------------------------

// A message we sent is read by definition. Returns true only when it is new.
export async function saveDm(db: D1Database, m: Dm, ownerId: string): Promise<boolean> {
  const r = await db
    .prepare(`INSERT OR IGNORE INTO dms (id, conversation_id, partner_id, sender_id, text, created_at, read, extra) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`)
    .bind(m.id, m.conversation_id, m.partner_id, m.sender_id, m.text, m.created_at, m.sender_id === ownerId ? 1 : 0, m.extra ? JSON.stringify(m.extra) : null)
    .run()
  const fresh = (r.meta.changes ?? 0) > 0
  // Answering, here or anywhere else, means what came before has been read.
  if (fresh && m.sender_id === ownerId) await db.prepare(`UPDATE dms SET read = 1 WHERE partner_id = ?1 AND created_at <= ?2`).bind(m.partner_id, m.created_at).run()
  return fresh
}

export const unreadDms = async (db: D1Database): Promise<number> =>
  (await db.prepare(`SELECT COUNT(DISTINCT partner_id) AS n FROM dms WHERE read = 0`).first<{ n: number }>())?.n ?? 0

export async function pushDm(env: Env, m: Dm): Promise<void> {
  const u = await env.DB.prepare(`SELECT username, name FROM x_users WHERE id = ?1`).bind(m.partner_id).first<{ username: string; name: string }>()
  const who = u?.name || (u?.username ? '@' + u.username : 'Someone')
  await fanOut(env.DB, { title: who, body: decode(m.text).slice(0, 240), tag: 'dm:' + m.partner_id, url: `/#/m/${m.partner_id}`, unread: await badge(env.DB) }, env)
}

// One row per person: the latest message and how many are unread.
export async function listConversations(db: D1Database) {
  const { results } = await db
    .prepare(`SELECT d.partner_id, d.text, d.sender_id, d.created_at, d.extra,
                     (SELECT COUNT(*) FROM dms r WHERE r.partner_id = d.partner_id AND r.read = 0) AS unread,
                     u.username, u.name, u.avatar
              FROM dms d
              LEFT JOIN x_users u ON u.id = d.partner_id
              WHERE d.id = (SELECT id FROM dms l WHERE l.partner_id = d.partner_id ORDER BY l.created_at DESC, l.id DESC LIMIT 1)
              ORDER BY d.created_at DESC`)
    .all()
  return results.map((r) => ({ ...r, extra: parseExtra(r.extra) }))
}

export async function listMessages(db: D1Database, partnerId: string) {
  const { results } = await db
    .prepare(`SELECT id, sender_id, text, created_at, extra FROM dms WHERE partner_id = ?1 ORDER BY created_at DESC, id DESC LIMIT 200`)
    .bind(partnerId)
    .all()
  return results.reverse().map((r) => ({ ...r, extra: parseExtra(r.extra) }))
}

// The safety net and the first fill: ask X for recent messages. A cent each,
// so only on request.
export async function syncDms(env: Env, x: X, token: string, ownerId: string, partnerId?: string): Promise<number> {
  const db = env.DB
  // Twenty at most: a cent each, and anything newer than the last check came
  // in through the webhook already.
  const page = await x.dms(token, ownerId, { partnerId, max: 20 })
  await saveUsers(db, page.users)
  let added = 0
  for (const m of page.dms) if (await saveDm(db, m, ownerId)) added++
  await setSetting(db, 'dms_synced', new Date().toISOString())
  return added
}

// --- what X really charged ---------------------------------------------------

// Spend is read off the balance: every drop between two readings is money
// spent; a rise is a top-up and is not counted.
export function spentFrom(readings: Array<{ total: number }>): number {
  let spent = 0
  for (let i = 1; i < readings.length; i++) spent += Math.max(0, readings[i - 1].total - readings[i].total)
  return spent
}

// Below this, the owner hears about it once, until the balance is topped up.
export const LOW_BALANCE = 2

// Read the balance from X (free), keep the day's reading, and warn once when
// it runs low. `every` throttles the calls made from busy paths.
export async function checkBalance(env: Env, x: X, token: string, every = 0) {
  const db = env.DB
  if (every) {
    const last = await getSetting(db, 'balance_checked_at')
    if (last && Date.now() - Date.parse(last) < every) return null
  }
  await setSetting(db, 'balance_checked_at', new Date().toISOString())
  const credits = await x.credits(token).catch(() => null)
  if (!credits) return null
  const day = new Date().toISOString().slice(0, 10)
  await db
    .prepare(`INSERT INTO balance (day, total) VALUES (?1, ?2) ON CONFLICT(day) DO UPDATE SET total = ?2, at = datetime('now')`)
    .bind(day, credits.total)
    .run()
  const warned = (await getSetting(db, 'low_balance_warned')) === '1'
  if (credits.total < LOW_BALANCE && !warned) {
    await setSetting(db, 'low_balance_warned', '1')
    await fanOut(db, { title: 'X credit is running low', body: `$${credits.total.toFixed(2)} left. Top up in the X developer console, or posting and replies will stop.`, tag: 'balance', url: '/#/settings', unread: await badge(db) }, env)
  } else if (credits.total >= LOW_BALANCE && warned) {
    await setSetting(db, 'low_balance_warned', '0')
  }
  return credits
}

export async function realSpend(env: Env, x: X, token: string) {
  const db = env.DB
  const credits = await checkBalance(env, x, token)
  const { results } = await db.prepare(`SELECT day, total FROM balance ORDER BY day`).all<{ day: string; total: number }>()
  const month = new Date().toISOString().slice(0, 7)
  // The month starts from the last reading before it, if there is one.
  let start = 0
  results.forEach((r, i) => { if (r.day < month + '-01') start = i })
  return {
    credits,
    spent: spentFrom(results),
    since: results[0]?.day ?? null,
    spentMonth: spentFrom(results.slice(start)),
    low: LOW_BALANCE,
  }
}

// The safety net under the webhook: read the owner's mentions since the last
// one we saw. An owned read, so a tenth of a cent per post.
export async function backfill(env: Env, x: X, token: string, ownerId: string): Promise<number> {
  const db = env.DB
  const since = await getSetting(db, 'mentions_since')
  const page = await x.mentions(token, ownerId, since ?? undefined)
  await saveUsers(db, page.users)
  // The mention posts themselves, with the extras read alongside them.
  const own = page.posts.flatMap((p) => cleanPosts([p]).map((c) => ({ ...c, extra: p.extra })))
  await savePosts(db, [...page.parents, ...own])
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
    // Top-level posts only: replies, to others or to yourself, stay out.
    .prepare(`SELECT id, text, created_at, extra FROM x_posts
              WHERE author_id = ?1 AND COALESCE(reply_to, '') = '' AND CAST(id AS INTEGER) >= CAST(?2 AS INTEGER) AND (?3 IS NULL OR CAST(id AS INTEGER) < CAST(?3 AS INTEGER))
              ORDER BY CAST(id AS INTEGER) DESC LIMIT ?4`)
    .bind(ownerId, oldest ?? '0', before, limit)
    .all<{ id: string; text: string; created_at: string | null; extra: string | null }>()
  return { items: results.map((r) => ({ ...r, extra: parseExtra(r.extra) })), synced: oldest !== null }
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
