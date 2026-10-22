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
  extra?: Extra
}

export interface Activity { kind: 'like' | 'follow'; post_id: string; actor_id: string; at: string }

export interface Parsed {
  notification: Notification | null
  dm: Dm | null
  // A post the owner liked, on X or anywhere.
  liked: string | null
  // Someone liked one of the owner's posts, or followed the owner.
  activity: Activity | null
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

// What a post's t.co links stand for, and what it carries. Built from the
// entities and media X sends alongside the text, so showing it costs nothing.
export interface Extra {
  // u: the t.co link in the text; x: where it goes; d: how X displays it;
  // m: set when the link is the post's own media (the text drops it).
  urls?: Array<{ u: string; x: string; d: string; m?: 1 }>
  media?: Array<{ type: string; url: string; alt?: string; w?: number; h?: number }>
  quoted?: string
}

export function extraOf(p: any, media: any[] = []): Extra | undefined {
  const out: Extra = {}
  const ents = p?.note_tweet?.entities?.urls ?? p?.entities?.urls ?? p?.message_create?.message_data?.entities?.urls
  if (Array.isArray(ents)) {
    const urls = ents
      .filter((e: any) => e?.url && (e.expanded_url || e.unwound_url))
      .map((e: any) => ({ u: String(e.url), x: String(e.unwound_url ?? e.expanded_url), d: String(e.display_url ?? e.expanded_url), ...(e.media_key ? { m: 1 as const } : {}) }))
    if (urls.length) out.urls = urls
  }
  const keys: string[] = Array.isArray(p?.attachments?.media_keys) ? p.attachments.media_keys.map(String) : []
  const found = keys
    .map((k) => (Array.isArray(media) ? media : []).find((m: any) => m?.media_key === k))
    .filter(Boolean)
    .map((m: any) => ({ type: String(m.type), url: String(m.url ?? m.preview_image_url ?? ''), alt: m.alt_text || undefined, w: m.width, h: m.height }))
    .filter((m) => m.url)
  if (found.length) out.media = found
  const quoted = ref(p, 'quoted')
  if (quoted) out.quoted = String(quoted)
  return Object.keys(out).length ? out : undefined
}

function cleanUsers(list: unknown): XUser[] {
  return (Array.isArray(list) ? list : [])
    .filter((u: any) => u && u.id && u.username)
    .map((u: any) => ({ id: String(u.id), username: u.username, name: u.name || u.username, profile_image_url: u.profile_image_url }))
}

export function cleanPosts(list: unknown, media: any[] = []): XPost[] {
  return (Array.isArray(list) ? list : [])
    .filter((p: any) => p && p.id && typeof p.text === 'string')
    .map((p: any) => ({ id: String(p.id), text: fullText(p)!, author_id: p.author_id ? String(p.author_id) : undefined, created_at: p.created_at, reply_to: replyTo(p), extra: extraOf(p, media) }))
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

const STRAYS: Record<string, string> = { 'post.repost.create': 'event_post' }

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
  const extra = extraOf(ev)
  return { id: String(ev.id), conversation_id: conv, partner_id: partner, sender_id: String(sender), text, created_at: iso(ev.created_at ?? ev.created_timestamp), ...(extra ? { extra } : {}) }
}

// Never throws: X warns that fields come and go, and one odd payload must not
// fail the delivery.
export function parseEvent(event: any, ownerId: string): Parsed {
  const out: Parsed = { notification: null, dm: null, liked: null, activity: null, users: [], posts: [], billed: null }
  try {
    const type: string = event?.event_type ?? ''
    const payload = event?.payload ?? {}
    out.users = cleanUsers(event?.includes?.users)
    const media = Array.isArray(event?.includes?.media) ? event.includes.media : []
    out.posts = cleanPosts(event?.includes?.tweets, media)

    if (POST_EVENTS[type]) {
      out.billed = 'event_post'
      out.notification = postNotification(POST_EVENTS[type], payload, ownerId)
      // The post itself is worth keeping too: a later reply may answer it.
      out.posts.push(...cleanPosts([payload], media))
    } else if (type === 'like.create') {
      out.billed = 'event_like'
      const liker = String(payload?.liking_user_id ?? '')
      const post = payload?.liked_tweet_id ? String(payload.liked_tweet_id) : ''
      // The owner's own like marks a reply as dealt with. Likes by others are
      // counted from the posts' numbers instead; a stray one is ignored.
      if (liker === ownerId && post) out.liked = post
    } else if (type === 'follow.follow') {
      out.billed = 'event_follow'
      const source = payload?.source?.data ?? payload?.source
      const target = payload?.target?.data ?? payload?.target
      out.users.push(...cleanUsers([source]))
      if (source?.id && String(source.id) !== ownerId && (!target?.id || String(target.id) === ownerId)) {
        out.activity = { kind: 'follow', post_id: '', actor_id: String(source.id), at: iso(event?.created_at) }
      }
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

// X sends text HTML-escaped. A push is plain text, so undo it.
export const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (all, e: string) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
    if (e[0] !== '#') return named[e.toLowerCase()] ?? all
    const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all
  })

export function pushText(type: NotificationType, actor: string, text: string | null): { title: string; body: string } {
  const title = {
    reply: `${actor} replied`,
    mention: `${actor} mentioned you`,
    quote: `${actor} quoted you`,
  }[type]
  return { title, body: decode(text ?? '').slice(0, 240) }
}
