import type { XPost, XUser } from './x'

// Turning what X sends into the one shape the app shows. The same function
// family serves the webhook and the mentions backfill, so a reply that
// arrives both ways lands on the same id and is stored once.

export type NotificationType = 'reply' | 'mention' | 'quote'

export interface Notification {
  id: string
  type: NotificationType
  actor_id: string
  post_id: string | null
  target_post_id: string | null
  text: string | null
  created_at: string
}

export interface Dm {
  id: string
  conversation_id: string | null
  partner_id: string
  sender_id: string
  text: string
  created_at: string
}

export interface Parsed {
  notification: Notification | null
  dm: Dm | null
  // A post the owner liked, on X or anywhere.
  liked: string | null
  users: XUser[]
  posts: XPost[]
  billed: string | null
}

const iso = (v: unknown): string => {
  const d = v ? new Date(typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : (v as string)) : new Date()
  return (isNaN(d.getTime()) ? new Date() : d).toISOString()
}

const ref = (post: any, type: string): string | null =>
  (Array.isArray(post?.referenced_tweets) ? post.referenced_tweets : []).find((r: any) => r?.type === type)?.id ?? null

// A long post comes as a 280-character teaser in `text` and the whole thing
// in `note_tweet`.
export const fullText = (post: any): string | null =>
  typeof post?.note_tweet?.text === 'string' ? post.note_tweet.text : typeof post?.text === 'string' ? post.text : null

// What a post answers: an id, '' for nothing, undefined when X did not say
// (a post without referenced_tweets may simply have been sent without them).
export function replyTo(post: any): string | undefined {
  const id = ref(post, 'replied_to') ?? post?.in_reply_to_tweet_id
  if (id) return String(id)
  return Array.isArray(post?.referenced_tweets) || post?.conversation_id === post?.id ? '' : undefined
}

function cleanUsers(list: unknown): XUser[] {
  return (Array.isArray(list) ? list : [])
    .filter((u: any) => u && u.id && u.username)
    .map((u: any) => ({ id: String(u.id), username: u.username, name: u.name || u.username, profile_image_url: u.profile_image_url }))
}

export function cleanPosts(list: unknown): XPost[] {
  return (Array.isArray(list) ? list : [])
    .filter((p: any) => p && p.id && typeof p.text === 'string')
    .map((p: any) => ({ id: String(p.id), text: fullText(p)!, author_id: p.author_id ? String(p.author_id) : undefined, created_at: p.created_at, reply_to: replyTo(p) }))
}

export function postNotification(type: NotificationType, post: any, ownerId: string): Notification | null {
  if (!post?.id || !post.author_id || String(post.author_id) === ownerId) return null
  const target = type === 'reply' ? ref(post, 'replied_to') ?? post.in_reply_to_tweet_id ?? null
    : type === 'quote' ? ref(post, 'quoted')
    : null
  return {
    // Replies, mentions and quotes share a namespace: one post, one row.
    id: 'post:' + post.id,
    type,
    actor_id: String(post.author_id),
    post_id: String(post.id),
    target_post_id: target ? String(target) : null,
    text: fullText(post),
    created_at: iso(post.created_at),
  }
}

const POST_EVENTS: Record<string, NotificationType> = {
  'post.mention.create': 'mention',
  'post.reply.create': 'reply',
  'post.quote.create': 'quote',
}

const STRAYS: Record<string, string> = { 'post.repost.create': 'event_post', 'follow.follow': 'event_follow' }

// A direct message, in either of the shapes X uses: the v2 dm_event, or the
// older message_create that the Activity API still delivers.
export function parseDm(ev: any, ownerId: string): Dm | null {
  if (!ev || typeof ev !== 'object') return null
  const mc = ev.message_create
  const sender = mc?.sender_id ?? ev.sender_id
  const text = mc?.message_data?.text ?? ev.text
  if (!ev.id || !sender || typeof text !== 'string') return null
  if (ev.event_type && ev.event_type !== 'MessageCreate') return null
  let partner: string | null = null
  if (String(sender) !== ownerId) partner = String(sender)
  else {
    const recipient = mc?.target?.recipient_id
    if (recipient) partner = String(recipient)
    else {
      const ids = (Array.isArray(ev.participant_ids) ? ev.participant_ids : String(ev.dm_conversation_id ?? '').split('-')).map(String)
      partner = ids.length === 2 ? ids.find((i: string) => i !== ownerId) ?? null : null
    }
  }
  // Group conversations are left out: the app only does one-to-one.
  const conv = ev.dm_conversation_id ? String(ev.dm_conversation_id) : null
  if (!partner || (conv && !/^\d+-\d+$/.test(conv))) return null
  return { id: String(ev.id), conversation_id: conv, partner_id: partner, sender_id: String(sender), text, created_at: iso(ev.created_at ?? ev.created_timestamp) }
}

// Never throws: X warns that fields come and go, and one odd payload must not
// fail the delivery.
export function parseEvent(event: any, ownerId: string): Parsed {
  const out: Parsed = { notification: null, dm: null, liked: null, users: [], posts: [], billed: null }
  try {
    const type: string = event?.event_type ?? ''
    const payload = event?.payload ?? {}
    out.users = cleanUsers(event?.includes?.users)
    out.posts = cleanPosts(event?.includes?.tweets)

    if (POST_EVENTS[type]) {
      out.billed = 'event_post'
      out.notification = postNotification(POST_EVENTS[type], payload, ownerId)
      // The post itself is worth keeping too: a later reply may answer it.
      out.posts.push(...cleanPosts([payload]))
    } else if (type === 'like.create') {
      out.billed = 'event_like'
      // Only the owner's own likes count. Likes on the owner's posts ask
      // nothing and are not subscribed to; a stray one is ignored.
      if (String(payload?.liking_user_id ?? '') === ownerId && payload?.liked_tweet_id) out.liked = String(payload.liked_tweet_id)
    } else if (STRAYS[type]) {
      // No longer subscribed to, so nothing to show; this only accounts for
      // a delivery that was already on its way.
      out.billed = STRAYS[type]
    } else if (type === 'dm.received' || type === 'dm.sent') {
      if (type === 'dm.received') out.billed = 'event_dm'
      const list = Array.isArray(payload?.direct_message_events) ? payload.direct_message_events : [payload]
      for (const ev of list) out.dm ??= parseDm(ev, ownerId)
      const users = payload?.users && typeof payload.users === 'object' && !Array.isArray(payload.users) ? Object.values(payload.users) : []
      out.users.push(...cleanUsers((users as any[]).map((u) => ({ ...u, username: u.username ?? u.screen_name, profile_image_url: u.profile_image_url ?? u.profile_image_url_https }))))
    }
  } catch {
    out.notification = null
    out.dm = null
  }
  return out
}

// A post from the mentions timeline is a reply when it answers the owner
// directly, and a plain mention otherwise.
export function mentionNotification(post: XPost, ownerId: string): Notification | null {
  const isReply = !!ref(post, 'replied_to') && String(post.in_reply_to_user_id ?? '') === ownerId
  return postNotification(isReply ? 'reply' : 'mention', post, ownerId)
}

export function pushText(type: NotificationType, actor: string, text: string | null): { title: string; body: string } {
  const title = {
    reply: `${actor} replied`,
    mention: `${actor} mentioned you`,
    quote: `${actor} quoted you`,
  }[type]
  return { title, body: (text ?? '').slice(0, 240) }
}
