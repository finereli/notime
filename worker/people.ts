import type { Env } from './env'
import type { X, XProfile } from './x'
import { parseExtra, savePosts, saveUsers } from './store'

// Other people: their profile, their latest posts, and following them. A
// profile costs a cent to look up and its posts half a cent each, so both
// are kept and asked for again only when they have gone stale.

const PROFILE_TTL = 24 * 3600_000
const TIMELINE_TTL = 3600_000

interface ProfileRow {
  user_id: string; description: string | null; location: string | null; url: string | null
  followers: number | null; following: number | null; posts: number | null
  i_follow: number | null; follows_me: number | null; fetched_at: number; timeline_at: number | null
}

async function saveProfile(db: D1Database, p: XProfile) {
  const status = Array.isArray(p.connection_status) ? p.connection_status : null
  const m = p.public_metrics ?? {}
  await db
    .prepare(`INSERT INTO profiles (user_id, description, location, url, followers, following, posts, i_follow, follows_me, fetched_at)
              VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
              ON CONFLICT(user_id) DO UPDATE SET description = ?2, location = ?3, url = ?4, followers = ?5, following = ?6, posts = ?7,
                i_follow = ?8, follows_me = ?9, fetched_at = ?10`)
    .bind(
      p.id, p.description ?? null, p.location ?? null, p.url ?? null,
      m.followers_count ?? null, m.following_count ?? null, m.tweet_count ?? null,
      status ? (status.includes('following') || status.includes('follow_request_sent') ? 1 : 0) : null,
      status ? (status.includes('followed_by') ? 1 : 0) : null,
      Date.now(),
    )
    .run()
}

const row = (db: D1Database, id: string) => db.prepare(`SELECT * FROM profiles WHERE user_id = ?1`).bind(id).first<ProfileRow>()
const who = (db: D1Database, id: string) =>
  db.prepare(`SELECT id, username, name, avatar FROM x_users WHERE id = ?1`).bind(id).first<{ id: string; username: string; name: string | null; avatar: string | null }>()

// The person and how the owner stands with them, from the cache when fresh.
export async function person(env: Env, x: X, token: () => Promise<string>, id: string, fresh = false) {
  const db = env.DB
  let p = await row(db, id)
  if (!p || fresh || Date.now() - p.fetched_at > PROFILE_TTL) {
    const got = await x.profile(await token(), id)
    if (got) {
      await saveUsers(db, [got])
      await saveProfile(db, got)
      p = await row(db, id)
    }
  }
  const user = await who(db, id)
  if (!user) return null
  return {
    ...user,
    description: p?.description ?? null, location: p?.location ?? null, url: p?.url ?? null,
    followers: p?.followers ?? null, following: p?.following ?? null, posts: p?.posts ?? null,
    i_follow: p?.i_follow == null ? null : !!p.i_follow, follows_me: !!p?.follows_me,
  }
}

// Their latest posts: what we hold, topped up from X at most once an hour.
export async function postsOf(env: Env, x: X, token: () => Promise<string>, id: string) {
  const db = env.DB
  const p = await row(db, id)
  if (p && (!p.timeline_at || Date.now() - p.timeline_at > TIMELINE_TTL)) {
    const newest = p.timeline_at
      ? (await db.prepare(`SELECT id FROM x_posts WHERE author_id = ?1 AND reply_to = '' ORDER BY length(id) DESC, id DESC LIMIT 1`).bind(id).first<{ id: string }>())?.id
      : undefined
    const posts = await x.userPosts(await token(), id, newest)
    await savePosts(db, posts)
    await db.prepare(`UPDATE profiles SET timeline_at = ?2 WHERE user_id = ?1`).bind(id, Date.now()).run()
  }
  const { results } = await db
    .prepare(`SELECT id, text, created_at, extra FROM x_posts WHERE author_id = ?1 AND reply_to = '' ORDER BY created_at DESC LIMIT 20`)
    .bind(id)
    .all<{ id: string; text: string; created_at: string; extra: string | null }>()
  return results.map((r) => ({ ...r, extra: parseExtra(r.extra) }))
}

export async function setFollow(env: Env, x: X, token: string, ownerId: string, id: string, on: boolean): Promise<boolean> {
  let following = false
  if (on) following = await x.follow(token, ownerId, id)
  else await x.unfollow(token, ownerId, id)
  await env.DB
    .prepare(`INSERT INTO profiles (user_id, i_follow, fetched_at) VALUES (?1, ?2, 0) ON CONFLICT(user_id) DO UPDATE SET i_follow = ?2`)
    .bind(id, on ? 1 : 0)
    .run()
  return following
}
