import type { Env } from './env'
import { bump, hasUrl } from './usage'

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
  getPost(token: string, id: string): Promise<XPost | null>
  createPost(token: string, body: PostBody): Promise<{ id: string; text: string }>
  uploadMedia(token: string, file: Blob): Promise<string>
  setAltText(token: string, mediaId: string, text: string): Promise<void>
  mentions(token: string, userId: string, sinceId?: string): Promise<MentionsPage>
  myPosts(token: string, userId: string, range: { sinceId?: string; untilId?: string }): Promise<PostsPage>
  listWebhooks(): Promise<Webhook[]>
  createWebhook(url: string): Promise<Webhook>
  validateWebhook(id: string): Promise<void>
  listSubscriptions(token: string): Promise<Subscription[]>
  createSubscription(token: string, body: Record<string, unknown>): Promise<void>
  deleteSubscription(token: string, id: string): Promise<void>
}

const API = 'https://api.x.com'

async function call(method: string, path: string, token: string, body?: BodyInit | Record<string, unknown>): Promise<any> {
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
      const r = await call('GET', `/2/tweets/${id}?tweet.fields=created_at,author_id`, token)
      await bump(db, 'post_read')
      return r?.data ?? null
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
        expansions: 'author_id,referenced_tweets.id',
        'tweet.fields': 'created_at,author_id,conversation_id,in_reply_to_user_id,referenced_tweets',
        'user.fields': 'profile_image_url,name,username',
      })
      if (sinceId) q.set('since_id', sinceId)
      const r = await call('GET', `/2/users/${userId}/mentions?${q}`, token)
      const posts: XPost[] = r?.data ?? []
      await bump(db, 'owned_read', posts.length)
      return { posts, users: r?.includes?.users ?? [], parents: r?.includes?.tweets ?? [], newestId: r?.meta?.newest_id }
    },
    async myPosts(token, userId, range) {
      // The owner's own timeline is an owned read too. Reposts are left out:
      // they are someone else's words.
      const q = new URLSearchParams({ max_results: range.sinceId ? '100' : '20', exclude: 'retweets', 'tweet.fields': 'created_at,author_id,note_tweet' })
      if (range.sinceId) q.set('since_id', range.sinceId)
      if (range.untilId) q.set('until_id', range.untilId)
      const r = await call('GET', `/2/users/${userId}/tweets?${q}`, token)
      const posts: XPost[] = (r?.data ?? []).map((p: any) => ({ id: String(p.id), text: p.note_tweet?.text ?? p.text, author_id: userId, created_at: p.created_at }))
      await bump(db, 'owned_read', posts.length)
      return { posts, oldestId: r?.meta?.oldest_id }
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
      return (await call('GET', '/2/activity/subscriptions', token))?.data ?? []
    },
    async createSubscription(token, body) {
      await call('POST', '/2/activity/subscriptions', token, body)
    },
    async deleteSubscription(token, id) {
      await call('DELETE', `/2/activity/subscriptions/${id}`, token)
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
    async getPost(_t, pid) { return { id: pid, text: 'An earlier post of yours, fetched on demand.', author_id: owner.id, created_at: new Date().toISOString() } },
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
    async listWebhooks() { return [{ id: 'wh1', url: 'https://notime.finereli.com/api/webhook/x', valid: true }] },
    async createWebhook(url) { return { id: 'wh1', url, valid: true } },
    async validateWebhook() {},
    async listSubscriptions() { return [] },
    async createSubscription() {},
    async deleteSubscription() {},
  }
}
