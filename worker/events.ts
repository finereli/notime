import type { XPost, XUser } from './x'

// Turning what X sends into the one shape the app shows. The same function
// family serves the webhook and the mentions backfill, so a reply that
// arrives both ways lands on the same id and is stored once.

export type NotificationType = 'reply' | 'mention' | 'quote' | 'repost' | 'like' | 'follow'

export interface Notification {
  id: string
  type: NotificationType
  actor_id: string
  post_id: string | null
  target_post_id: string | null
  text: string | null
  created_at: string
}

export interface Parsed {
  notification: Notification | null
  users: XUser[]
  posts: XPost[]
  billed: string | null
}

const iso = (v: unknown): string => {
  const d = v ? new Date(v as string) : new Date()
  return (isNaN(d.getTime()) ? new Date() : d).toISOString()
}

const ref = (post: any, type: string): string | null =>
  (Array.isArray(post?.referenced_tweets) ? post.referenced_tweets : []).find((r: any) => r?.type === type)?.id ?? null

function cleanUsers(list: unknown): XUser[] {
  return (Array.isArray(list) ? list : [])
    .filter((u: any) => u && u.id && u.username)
    .map((u: any) => ({ id: String(u.id), username: u.username, name: u.name || u.username, profile_image_url: u.profile_image_url }))
}

function cleanPosts(list: unknown): XPost[] {
  return (Array.isArray(list) ? list : [])
    .filter((p: any) => p && p.id && typeof p.text === 'string')
    .map((p: any) => ({ id: String(p.id), text: p.text, author_id: p.author_id ? String(p.author_id) : undefined, created_at: p.created_at }))
}

export function postNotification(type: NotificationType, post: any, ownerId: string): Notification | null {
  if (!post?.id || !post.author_id || String(post.author_id) === ownerId) return null
  const target = type === 'reply' ? ref(post, 'replied_to') ?? post.in_reply_to_tweet_id ?? null
    : type === 'quote' ? ref(post, 'quoted')
    : type === 'repost' ? ref(post, 'retweeted')
    : null
  return {
    // Replies, mentions and quotes share a namespace: one post, one row.
    id: (type === 'repost' ? 'repost:' : 'post:') + post.id,
    type,
    actor_id: String(post.author_id),
    post_id: String(post.id),
    target_post_id: target ? String(target) : null,
    text: typeof post.text === 'string' ? post.text : null,
    created_at: iso(post.created_at),
  }
}

const POST_EVENTS: Record<string, NotificationType> = {
  'post.mention.create': 'mention',
  'post.reply.create': 'reply',
  'post.quote.create': 'quote',
  'post.repost.create': 'repost',
}

// Never throws: X warns that fields come and go, and one odd payload must not
// fail the delivery.
export function parseEvent(event: any, ownerId: string): Parsed {
  const out: Parsed = { notification: null, users: [], posts: [], billed: null }
  try {
    const type: string = event?.event_type ?? ''
    const payload = event?.payload ?? {}
    out.users = cleanUsers(event?.includes?.users)
    out.posts = cleanPosts(event?.includes?.tweets)

    if (POST_EVENTS[type]) {
      out.billed = 'event_post'
      out.notification = postNotification(POST_EVENTS[type], payload, ownerId)
    } else if (type === 'like.create') {
      out.billed = 'event_like'
      const liker = payload.liking_user_id && String(payload.liking_user_id)
      const author = payload.liked_tweet_author_id && String(payload.liked_tweet_author_id)
      if (liker && liker !== ownerId && payload.liked_tweet_id && (!author || author === ownerId)) {
        out.notification = {
          id: `like:${liker}:${payload.liked_tweet_id}`,
          type: 'like',
          actor_id: liker,
          post_id: null,
          target_post_id: String(payload.liked_tweet_id),
          text: null,
          created_at: iso(payload.created_at ?? event.created_at),
        }
      }
    } else if (type === 'follow.follow') {
      out.billed = 'event_follow'
      const source = payload?.source?.data ?? payload?.source
      const target = payload?.target?.data ?? payload?.target
      out.users.push(...cleanUsers([source]))
      if (source?.id && String(source.id) !== ownerId && (!target?.id || String(target.id) === ownerId)) {
        out.notification = {
          id: `follow:${source.id}`,
          type: 'follow',
          actor_id: String(source.id),
          post_id: null,
          target_post_id: null,
          text: null,
          created_at: iso(event.created_at),
        }
      }
    }
  } catch {
    out.notification = null
  }
  return out
}

// A post from the mentions timeline is a reply when it answers the owner
// directly, and a plain mention otherwise.
export function mentionNotification(post: XPost, ownerId: string): Notification | null {
  const isReply = !!ref(post, 'replied_to') && String(post.in_reply_to_user_id ?? '') === ownerId
  return postNotification(isReply ? 'reply' : 'mention', post, ownerId)
}

export function pushText(type: NotificationType, actor: string, text: string | null, targetText: string | null): { title: string; body: string } {
  const title = {
    reply: `${actor} replied`,
    mention: `${actor} mentioned you`,
    quote: `${actor} quoted you`,
    repost: `${actor} reposted you`,
    like: `${actor} liked your post`,
    follow: `${actor} followed you`,
  }[type]
  const body = type === 'like' || type === 'repost' ? targetText ?? '' : text ?? ''
  return { title, body: body.slice(0, 240) }
}

export const PUSH_BY_DEFAULT: NotificationType[] = ['reply', 'mention', 'quote']
