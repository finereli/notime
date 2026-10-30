import type { Env } from './env'
import { bump, hasUrl } from './usage'
import { cleanPosts, parseDm, type Dm, type Extra } from './events'

// Everything we ask of X goes through this interface, so local development
// and the tests can run against a fake that costs nothing and posts nothing.

export interface XUser { id: string; username: string; name: string; profile_image_url?: string }
export interface XPost {
  id: string
  text: string
  author_id?: string
  created_at?: string
  in_reply_to_user_id?: string
  referenced_tweets?: Array<{ type: string; id: string }>
  // The post this one answers: '' for none, undefined when unknown.
  reply_to?: string
  extra?: Extra
}
export interface PostBody {
  text?: string
  media?: { media_ids: string[] }
  reply?: { in_reply_to_tweet_id: string }
  quote_tweet_id?: string
  poll?: { options: string[]; duration_minutes: number }
  reply_settings?: string
}
export interface Webhook { id: string; url: string; valid: boolean }
export interface Subscription { id: string; event_type: string; webhook_id?: string; filter?: Record<string, unknown> }
export interface PostsPage { posts: XPost[]; oldestId?: string }
export interface MentionsPage { posts: XPost[]; users: XUser[]; parents: XPost[]; newestId?: string }
export interface DmPage { dms: Dm[]; users: XUser[]; next?: string }
// The parts of a profile the app shows, and how the owner stands with them.
export interface XProfile extends XUser {
  description?: string
  location?: string
  url?: string
  public_metrics?: { followers_count?: number; following_count?: number; tweet_count?: number }
  connection_status?: string[]
}
export interface Credits { total: number; free: number; prepaid: number; expires?: string }

export class XError extends Error {
  constructor(public status: number, public detail: string, public body?: unknown) {
    super(detail)
  }
}

export interface X {
  me(token: string): Promise<XUser>
  // Whether the account may post past 280 characters. null when X will not say.
  longPosts(token: string): Promise<boolean | null>
  getUser(token: string, id: string): Promise<XUser | null>
  // Any post, with its author when X sends one.
  getPost(token: string, id: string): Promise<(XPost & { author?: XUser }) | null>
  createPost(token: string, body: PostBody): Promise<{ id: string; text: string }>
  uploadMedia(token: string, file: Blob): Promise<string>
  setAltText(token: string, mediaId: string, text: string): Promise<void>
  mentions(token: string, userId: string, sinceId?: string): Promise<MentionsPage>
  myPosts(token: string, userId: string, range: { sinceId?: string; untilId?: string }): Promise<PostsPage>
  listWebhooks(): Promise<Webhook[]>
  createWebhook(url: string): Promise<Webhook>
  validateWebhook(id: string): Promise<void>
  // Ask X to resend what it delivered, or tried to, between two times (the
  // last 24 hours at most). Returns the job id.
  replayWebhook(id: string, from: Date, to: Date): Promise<string>
  listSubscriptions(token: string): Promise<Subscription[]>
  createSubscription(token: string, body: Record<string, unknown>): Promise<void>
  deleteSubscription(token: string, id: string): Promise<void>
  like(token: string, userId: string, postId: string): Promise<void>
  // The owner's latest top-level posts with their like counts. An owned read.
  myStats(token: string, userId: string): Promise<{ posts: XPost[]; likes: Record<string, number> }>
  // The ids of the owner's most recent likes.
  likedPosts(token: string, userId: string): Promise<string[]>
  unlike(token: string, userId: string, postId: string): Promise<void>
  // Recent direct messages, all conversations or one person's.
  dms(token: string, ownerId: string, opts: { partnerId?: string; next?: string; max?: number }): Promise<DmPage>
  sendDm(token: string, ownerId: string, partnerId: string, text: string): Promise<Dm>
  findUser(token: string, username: string): Promise<XUser | null>
  credits(token: string): Promise<Credits | null>
  // Someone else's profile and their latest posts, replies and reposts left out.
  profile(token: string, id: string): Promise<XProfile | null>
  userPosts(token: string, id: string, sinceId?: string): Promise<XPost[]>
  // Returns whether X now has the owner following them (false while a
  // request to a protected account waits).
  follow(token: string, ownerId: string, targetId: string): Promise<boolean>
  unfollow(token: string, ownerId: string, targetId: string): Promise<void>
}

const API = 'https://api.x.com'

export async function call(method: string, path: string, token: string, body?: BodyInit | Record<string, unknown>): Promise<any> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
  let payload: BodyInit | undefined
  if (body instanceof FormData) payload = body
  else if (body) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const res = await fetch(API + path, { method, headers, body: payload })
  const text = await res.text()
  let data: any = null
  try { data = text ? JSON.parse(text) : null } catch {}
  if (!res.ok) throw new XError(res.status, problemDetail(data) || text.slice(0, 300) || `X answered ${res.status}`, data)
  return data
}

// X reports errors in two or three shapes. Find the sentence a person can read.
export function problemDetail(data: any): string {
  if (!data) return ''
  if (typeof data.detail === 'string') return data.detail
  if (Array.isArray(data.errors) && data.errors.length) {
    const e = data.errors[0]
    return e.detail || e.message || e.title || ''
  }
  return data.error_description || data.title || data.message || ''
}

const USER_FIELDS = 'user.fields=profile_image_url,name,username'
const POST_FIELDS = 'created_at,author_id,conversation_id,in_reply_to_user_id,referenced_tweets,note_tweet,entities,attachments'
// Images come free with the post when asked for: the URLs, not the bytes.
const MEDIA = { expansions: 'attachments.media_keys', 'media.fields': 'url,preview_image_url,type,alt_text,width,height' }
const DM_QUERY = {
  event_types: 'MessageCreate',
  'dm_event.fields': 'id,text,event_type,created_at,sender_id,dm_conversation_id,participant_ids,entities,referenced_tweets',
  expansions: 'sender_id,participant_ids',
  'user.fields': 'profile_image_url,name,username',
}

export function realX(env: Env): X {
  const db = env.DB
  return {
    async me(token) {
      return (await call('GET', `/2/users/me?${USER_FIELDS}`, token)).data
    },
    async longPosts(token) {
      // Long posts come with Premium. X reports the subscription only to the
      // account itself, and not always, so every answer but a clear one is null.
      try {
        const u = (await call('GET', '/2/users/me?user.fields=subscription_type,verified_type', token))?.data
        const sub = String(u?.subscription_type ?? '').toLowerCase()
        if (sub.startsWith('premium')) return true
        if (sub === 'none' || sub === 'basic') return false
        return null
      } catch {
        return null
      }
    },
    async getUser(token, id) {
      const r = await call('GET', `/2/users/${id}?${USER_FIELDS}`, token)
      await bump(db, 'user_read')
      return r?.data ?? null
    },
    async getPost(token, id) {
      const q = new URLSearchParams({ 'tweet.fields': POST_FIELDS, ...MEDIA, expansions: 'author_id,attachments.media_keys', 'user.fields': 'profile_image_url,name,username' })
      const r = await call('GET', `/2/tweets/${id}?${q}`, token)
      await bump(db, 'post_read')
      const post = cleanPosts([r?.data], r?.includes?.media)[0] ?? null
      const author = r?.includes?.users?.[0]
      return post && author ? { ...post, author } : post
    },
    async createPost(token, body) {
      const r = await call('POST', '/2/tweets', token, body as Record<string, unknown>)
      await bump(db, hasUrl(body.text || '') ? 'post_create_url' : 'post_create')
      return r.data
    },
    async uploadMedia(token, file) {
      const form = new FormData()
      form.append('media', file, 'image')
      form.append('media_category', 'tweet_image')
      const r = await call('POST', '/2/media/upload', token, form)
      return String(r.data.id)
    },
    async setAltText(token, mediaId, text) {
      await call('POST', '/2/media/metadata', token, { id: mediaId, metadata: { alt_text: { text } } })
      await bump(db, 'media_metadata')
    },
    async mentions(token, userId, sinceId) {
      const q = new URLSearchParams({
        max_results: sinceId ? '100' : '20',
        ...MEDIA,
        expansions: 'author_id,referenced_tweets.id,attachments.media_keys',
        'tweet.fields': POST_FIELDS,
        'user.fields': 'profile_image_url,name,username',
      })
      if (sinceId) q.set('since_id', sinceId)
      const r = await call('GET', `/2/users/${userId}/mentions?${q}`, token)
      // Keep the raw shape (referenced_tweets and all), the full text, and the extras.
      const media = r?.includes?.media ?? []
      const posts: XPost[] = (r?.data ?? []).map((p: any) => ({ ...p, text: p.note_tweet?.text ?? p.text, extra: cleanPosts([p], media)[0]?.extra }))
      await bump(db, 'owned_read', posts.length)
      return { posts, users: r?.includes?.users ?? [], parents: cleanPosts(r?.includes?.tweets, media), newestId: r?.meta?.newest_id }
    },
    async myPosts(token, userId, range) {
      // The owner's own timeline is an owned read too. Reposts are left out:
      // they are someone else's words.
      const q = new URLSearchParams({ max_results: range.sinceId ? '100' : '20', exclude: 'retweets', 'tweet.fields': POST_FIELDS, ...MEDIA })
      if (range.sinceId) q.set('since_id', range.sinceId)
      if (range.untilId) q.set('until_id', range.untilId)
      const r = await call('GET', `/2/users/${userId}/tweets?${q}`, token)
      const posts: XPost[] = cleanPosts(r?.data, r?.includes?.media).map((p) => ({ ...p, author_id: userId }))
      await bump(db, 'owned_read', posts.length)
      return { posts, oldestId: r?.meta?.oldest_id }
    },
    async replayWebhook(id, from, to) {
      const stamp = (d: Date) => d.toISOString().replace(/[-:T]/g, '').slice(0, 12)
      const r = await call('POST', '/2/webhooks/replay', env.X_BEARER_TOKEN, { webhook_id: id, from_date: stamp(from), to_date: stamp(to) })
      return String(r?.data?.job_id ?? '')
    },
    async listWebhooks() {
      return (await call('GET', '/2/webhooks', env.X_BEARER_TOKEN))?.data ?? []
    },
    async createWebhook(url) {
      return (await call('POST', '/2/webhooks', env.X_BEARER_TOKEN, { url })).data
    },
    async validateWebhook(id) {
      await call('PUT', `/2/webhooks/${id}`, env.X_BEARER_TOKEN)
    },
    async listSubscriptions(token) {
      // X names the id subscription_id here, and id nowhere else.
      return ((await call('GET', '/2/activity/subscriptions', token))?.data ?? []).map((s: any) => ({ ...s, id: String(s.subscription_id ?? s.id) }))
    },
    async createSubscription(token, body) {
      await call('POST', '/2/activity/subscriptions', token, body)
    },
    async deleteSubscription(token, id) {
      await call('DELETE', `/2/activity/subscriptions/${id}`, token)
    },
    async like(token, userId, postId) {
      await call('POST', `/2/users/${userId}/likes`, token, { tweet_id: postId })
      await bump(db, 'like')
    },
    async unlike(token, userId, postId) {
      await call('DELETE', `/2/users/${userId}/likes/${postId}`, token)
      await bump(db, 'unlike')
    },
    async myStats(token, userId) {
      const q = new URLSearchParams({ max_results: '10', exclude: 'retweets,replies', 'tweet.fields': POST_FIELDS + ',public_metrics', ...MEDIA })
      const r = await call('GET', `/2/users/${userId}/tweets?${q}`, token)
      const data: any[] = r?.data ?? []
      await bump(db, 'owned_read', data.length)
      const likes = Object.fromEntries(data.map((p) => [String(p.id), Number(p.public_metrics?.like_count ?? 0)]))
      return { posts: cleanPosts(data, r?.includes?.media).map((p) => ({ ...p, author_id: userId })), likes }
    },
    async likedPosts(token, userId) {
      const r = await call('GET', `/2/users/${userId}/liked_tweets?max_results=100`, token)
      const ids = (r?.data ?? []).map((p: any) => String(p.id))
      await bump(db, 'like_read', ids.length)
      return ids
    },
    async dms(token, ownerId, { partnerId, next, max = 50 }) {
      const q = new URLSearchParams({ ...DM_QUERY, max_results: String(max) })
      if (next) q.set('pagination_token', next)
      const path = partnerId ? `/2/dm_conversations/with/${partnerId}/dm_events` : '/2/dm_events'
      const r = await call('GET', `${path}?${q}`, token)
      const dms = (r?.data ?? []).map((e: any) => parseDm(e, ownerId)).filter(Boolean) as Dm[]
      await bump(db, 'dm_read', (r?.data ?? []).length)
      return { dms, users: r?.includes?.users ?? [], next: r?.meta?.next_token }
    },
    async sendDm(token, ownerId, partnerId, text) {
      const r = await call('POST', `/2/dm_conversations/with/${partnerId}/messages`, token, { text })
      await bump(db, 'dm_send')
      return { id: String(r.data.dm_event_id), conversation_id: r.data.dm_conversation_id ?? null, partner_id: partnerId, sender_id: ownerId, text, created_at: new Date().toISOString() }
    },
    async findUser(token, username) {
      const r = await call('GET', `/2/users/by/username/${encodeURIComponent(username)}?${USER_FIELDS}`, token).catch((e) => {
        if (e instanceof XError && e.status === 404) return null
        throw e
      })
      if (r?.data) await bump(db, 'user_read')
      return r?.data ?? null
    },
    async profile(token, id) {
      const fields = 'profile_image_url,name,username,description,location,url,public_metrics,connection_status,entities'
      const r = await call('GET', `/2/users/${id}?user.fields=${fields}`, token).catch((e) => {
        if (e instanceof XError && e.status === 404) return null
        throw e
      })
      if (!r?.data) return null
      await bump(db, 'user_read')
      const d = r.data
      // The bio's links come as t.co; show where they go.
      const expand = (s: string | undefined, urls: any[] | undefined) =>
        (urls ?? []).reduce((t: string, u: any) => (u?.url && u?.expanded_url ? t.split(u.url).join(u.display_url ?? u.expanded_url) : t), s ?? '')
      return {
        ...d,
        description: expand(d.description, d.entities?.description?.urls),
        url: d.entities?.url?.urls?.[0]?.expanded_url ?? d.url,
      }
    },
    async userPosts(token, id, sinceId) {
      const q = new URLSearchParams({ max_results: '10', exclude: 'retweets,replies', 'tweet.fields': POST_FIELDS, ...MEDIA })
      if (sinceId) q.set('since_id', sinceId)
      const r = await call('GET', `/2/users/${id}/tweets?${q}`, token)
      const data = r?.data ?? []
      await bump(db, 'post_read', data.length)
      return cleanPosts(data, r?.includes?.media).map((p) => ({ ...p, author_id: id }))
    },
    async follow(token, ownerId, targetId) {
      const r = await call('POST', `/2/users/${ownerId}/following`, token, { target_user_id: targetId })
      await bump(db, 'follow')
      return !!r?.data?.following
    },
    async unfollow(token, ownerId, targetId) {
      await call('DELETE', `/2/users/${ownerId}/following/${targetId}`, token)
      await bump(db, 'unfollow')
    },
    async credits(token) {
      // The real balance, straight from X. Free to ask.
      const d = (await call('GET', '/2/usage/credits', token))?.data
      if (!d || typeof d.total_balance !== 'number') return null
      const expires = (d.free_grants ?? []).map((g: any) => g?.expires_at).filter(Boolean).sort()[0]
      return { total: d.total_balance, free: d.free_balance ?? 0, prepaid: d.prepaid_balance ?? 0, expires }
    },
  }
}

// The stand-in for local development. It remembers nothing and bills nothing.
export function fakeX(env: Env): X {
  const owner: XUser = { id: '1000', username: env.OWNER_USERNAME, name: 'Dev Owner' }
  const ana: XUser = { id: '2001', username: 'ana_writes', name: 'Ana Lima' }
  let n = 0
  const id = () => String(Date.now()) + String(n++)
  return {
    async me() { return owner },
    async longPosts() { return null },
    async getUser(_t, uid) { return { id: uid, username: 'user' + uid, name: 'User ' + uid } },
    async getPost(_t, pid) {
      // Ids starting 55 are someone else's posts, the kind a link points at.
      if (pid.startsWith('55')) {
        return {
          id: pid, author_id: ana.id, author: ana, created_at: new Date().toISOString(), reply_to: '',
          text: 'Small tools win because they finish. https://t.co/pic55',
          extra: { urls: [{ u: 'https://t.co/pic55', x: `https://x.com/ana_writes/status/${pid}/photo/1`, d: 'pic.x.com/pic55', m: 1 }], media: [{ type: 'photo', url: '/icons/icon-192.png' }] },
        }
      }
      return { id: pid, text: 'An earlier post of yours, fetched on demand.', author_id: owner.id, created_at: new Date().toISOString() }
    },
    async createPost(_t, body) {
      if ((body.text || '').includes('#fail')) throw new XError(403, 'You are not permitted to perform this action.')
      if (body.quote_tweet_id && !(body.text || '').includes('#quoteok')) throw new XError(403, 'Quote posts are not available on your current plan.')
      return { id: id(), text: body.text || '' }
    },
    async uploadMedia() { return id() },
    async setAltText() {},
    async mentions(_t, _u, sinceId) {
      if (sinceId) return { posts: [], users: [], parents: [] }
      const now = Date.now()
      return {
        posts: [
          { id: '9002', text: `@${owner.username} this is the clearest explanation of the idea I have read. Did you consider the offline case?`, author_id: ana.id, created_at: new Date(now - 36e5).toISOString(), in_reply_to_user_id: owner.id, referenced_tweets: [{ type: 'replied_to', id: '9001' }] },
          { id: '9003', text: `Reading @${owner.username} on small tools again. Worth your time.`, author_id: ana.id, created_at: new Date(now - 72e5).toISOString() },
        ],
        users: [ana],
        parents: [{ id: '9001', text: 'Most tools get worse as they get bigger. The trick is to notice when to stop.', author_id: owner.id, created_at: new Date(now - 4 * 36e5).toISOString() }],
        newestId: '9003',
      }
    },
    async myPosts(_t, userId, range) {
      if (range.sinceId || range.untilId) return { posts: [] }
      const now = Date.now()
      const posts = [
        { id: '9001', text: 'Most tools get worse as they get bigger. The trick is to notice when to stop.', author_id: userId, created_at: new Date(now - 4 * 36e5).toISOString() },
        { id: '8001', text: 'Wrote a tiny Mac app this week. It does one thing, and I already use it more than apps ten times its size.', author_id: userId, created_at: new Date(now - 30 * 36e5).toISOString() },
        { id: '7500', text: 'The best feature request is the one you can answer by deleting something.', author_id: userId, created_at: new Date(now - 80 * 36e5).toISOString() },
      ]
      return { posts, oldestId: '7500' }
    },
    async replayWebhook() { return 'job-dev' },
    async listWebhooks() { return [{ id: 'wh1', url: 'https://notime.finereli.com/api/webhook/x', valid: true }] },
    async createWebhook(url) { return { id: 'wh1', url, valid: true } },
    async validateWebhook() {},
    async listSubscriptions() { return [] },
    async createSubscription() {},
    async deleteSubscription() {},
    async like(_t, _u, postId) {
      if (postId === '0') throw new XError(403, 'You are not permitted to like this post.')
    },
    async unlike() {},
    async likedPosts() { return [] },
    async myStats(_t, userId) {
      const now = new Date().toISOString()
      return { posts: [{ id: '9001', text: 'Most tools get worse as they get bigger. The trick is to notice when to stop.', author_id: userId, created_at: now, reply_to: '' }], likes: { '9001': 2 + Math.floor(Date.now() / 60000) % 3 } }
    },
    async dms(_t, ownerId, { partnerId, next }) {
      if (next) return { dms: [], users: [] }
      const now = Date.now()
      const all: Dm[] = [
        { id: 'd3', conversation_id: `${ownerId}-2001`, partner_id: '2001', sender_id: '2001', text: 'Also, is the offline mode open source?', created_at: new Date(now - 20 * 6e4).toISOString() },
        { id: 'd2', conversation_id: `${ownerId}-2001`, partner_id: '2001', sender_id: ownerId, text: 'Thanks! Happy to talk about it.', created_at: new Date(now - 50 * 6e4).toISOString() },
        { id: 'd1', conversation_id: `${ownerId}-2001`, partner_id: '2001', sender_id: '2001', text: 'Loved the post about small tools. Could I ask you a couple of questions?', created_at: new Date(now - 90 * 6e4).toISOString() },
        { id: 'd0', conversation_id: `${ownerId}-3003`, partner_id: '3003', sender_id: '3003', text: 'Are you coming to the meetup on Thursday?', created_at: new Date(now - 26 * 36e5).toISOString() },
      ]
      return { dms: all.filter((d) => !partnerId || d.partner_id === partnerId), users: [ana, { id: '3003', username: 'tomasz', name: 'Tomasz Nowak' }] }
    },
    async sendDm(_t, ownerId, partnerId, text) {
      if (text.includes('#fail')) throw new XError(403, 'You cannot send messages to this user.')
      return { id: id(), conversation_id: `${ownerId}-${partnerId}`, partner_id: partnerId, sender_id: ownerId, text, created_at: new Date().toISOString() }
    },
    async findUser(_t, username) {
      return username === 'nobody' ? null : { id: '4' + username.length + '00', username, name: username[0].toUpperCase() + username.slice(1) }
    },
    async credits() { return { total: 19.81, free: 19.81, prepaid: 0, expires: '2027-01-09T16:20:47.000Z' } },
    async profile(_t, id) {
      const u = id === ana.id ? ana : { id, username: 'tomasz', name: 'Tomasz Nowak' }
      return { ...u, description: 'Writes about small software and the people who make it. Lisbon.', location: 'Lisbon', url: 'https://example.com', public_metrics: { followers_count: 1234, following_count: 321, tweet_count: 4567 }, connection_status: id === ana.id ? ['followed_by'] : [] }
    },
    async userPosts(_t, id, sinceId) {
      if (sinceId) return []
      const now = Date.now()
      return [
        { id: '9501', text: 'Small tools win because you can hold all of them in your head at once.', author_id: id, created_at: new Date(now - 5 * 36e5).toISOString(), reply_to: '' },
        { id: '9502', text: 'Spent the morning deleting code. Best morning this month.', author_id: id, created_at: new Date(now - 30 * 36e5).toISOString(), reply_to: '' },
      ]
    },
    async follow(_t, _o, targetId) {
      if (targetId === '0') throw new XError(403, 'You cannot follow this account.')
      return true
    },
    async unfollow() {},
  }
}
