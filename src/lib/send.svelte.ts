import { auth } from './auth.svelte'
import { api } from './api'
import { drafts } from './drafts.svelte'
import { postIsEmpty, type Draft } from './drafts-core'

// Posting a draft: upload each image, then create each post, each one a reply
// to the one before. Progress is written into the draft as it happens, so a
// failure halfway leaves a draft that knows where to pick up.

export interface Sent { ids: string[]; url: string }
// What a post answers: a notification, or one of the owner's own posts, which
// can be followed up (a reply to yourself) or quoted.
// other: a reply to someone else's post, reached through a link.
export interface ReplyTarget { postId: string; notificationId?: string; quote?: boolean; other?: boolean }

// X forgets an uploaded image after a day. Stay well inside that.
const MEDIA_TTL = 20 * 3600 * 1000

class Sending { active = $state(false) }
export const sending = new Sending()

async function fail(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as { error?: string }
  throw new Error(res.status === 401 ? 'Sign in again to post. Your draft is safe.' : body.error || fallback)
}

export async function sendDraft(draft: Draft, reply: ReplyTarget | null, progress: (label: string) => void): Promise<Sent> {
  sending.active = true
  try {
    // Blank posts in the middle of a thread are just noise. Drop them.
    const posts = draft.posts.filter((p) => p.sentId || !postIsEmpty(p))
    if (!posts.length) throw new Error('Write something first')
    draft.posts = posts
    const total = posts.length
    let previous = reply && !reply.quote ? reply.postId : undefined

    for (let i = 0; i < total; i++) {
      const post = draft.posts[i]
      if (post.sentId) { previous = post.sentId; continue }

      for (let j = 0; j < post.images.length; j++) {
        const image = post.images[j]
        if (image.mediaId && image.uploadedAt && Date.now() - image.uploadedAt < MEDIA_TTL) continue
        progress(`Uploading image ${j + 1} of ${post.images.length}`)
        const blob = await drafts.imageBlob(image.id)
        if (!blob) throw new Error('An image went missing from this device. Remove it and add it again.')
        const form = new FormData()
        form.append('file', blob, 'image.jpg')
        if (image.alt.trim()) form.append('alt', image.alt.trim())
        const res = await api('/api/media', { method: 'POST', body: form })
        if (!res.ok) await fail(res, 'The image upload failed')
        image.mediaId = ((await res.json()) as { id: string }).id
        image.uploadedAt = Date.now()
        drafts.flush()
      }

      progress(total > 1 ? `Posting ${i + 1} of ${total}` : 'Posting')
      const first = i === 0
      const res = await api('/api/posts', {
        method: 'POST',
        body: {
          text: post.text.trim(),
          media_ids: post.images.map((im) => im.mediaId!),
          poll: first && draft.poll ? { options: draft.poll.options.map((o) => o.trim()).filter(Boolean), minutes: draft.poll.minutes } : null,
          reply_settings: first && !reply ? draft.replySettings : undefined,
          reply_to: previous,
          quote_post_id: first && reply?.quote ? reply.postId : undefined,
          notification_id: first ? reply?.notificationId : undefined,
        },
      })
      if (!res.ok) await fail(res, 'X did not accept the post')
      const made = (await res.json()) as { id: string }
      post.sentId = made.id
      previous = made.id
      drafts.flush()
    }
    const ids = draft.posts.map((p) => p.sentId!)
    return { ids, url: `https://x.com/${auth.user?.username ?? "i"}/status/${ids[0]}` }
  } finally {
    sending.active = false
  }
}
