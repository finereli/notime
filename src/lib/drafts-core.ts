// What a draft is and how the set of drafts changes. Pure functions over
// plain data, so the rules can be tested without a browser.

export interface DraftImage { id: string; alt: string; mediaId?: string; uploadedAt?: number }
export interface DraftPost { text: string; images: DraftImage[]; sentId?: string }
export interface Poll { options: string[]; minutes: number }
export interface Draft {
  id: string
  // Set on reply drafts: the notification being answered.
  replyTo?: string
  posts: DraftPost[]
  poll: Poll | null
  replySettings: string
  updatedAt: number
}
export interface DraftState { currentId: string; drafts: Record<string, Draft> }

export const replyId = (notificationId: string) => 'reply:' + notificationId

export function newDraft(id: string, replyTo?: string): Draft {
  return { id, replyTo, posts: [{ text: '', images: [] }], poll: null, replySettings: 'everyone', updatedAt: Date.now() }
}

export const postIsEmpty = (p: DraftPost) => !p.text.trim() && p.images.length === 0

export function isEmpty(d: Draft): boolean {
  return d.posts.every(postIsEmpty) && !(d.poll && d.poll.options.some((o) => o.trim()))
}

export function initial(id: string): DraftState {
  return { currentId: id, drafts: { [id]: newDraft(id) } }
}

// Storage can hold anything: an older shape, half a write, someone's edit.
// Whatever is there, come back with a usable state.
export function load(raw: string | null, mkId: () => string): DraftState {
  try {
    const s = JSON.parse(raw || 'null') as DraftState | null
    if (s && typeof s.currentId === 'string' && s.drafts && typeof s.drafts === 'object') {
      const drafts: Record<string, Draft> = {}
      for (const [id, d] of Object.entries(s.drafts)) {
        if (!d || !Array.isArray(d.posts) || !d.posts.length) continue
        drafts[id] = {
          id,
          replyTo: d.replyTo,
          posts: d.posts.map((p) => ({ text: String(p?.text ?? ''), images: Array.isArray(p?.images) ? p.images.filter((i) => i && i.id) : [], sentId: p?.sentId })),
          poll: d.poll && Array.isArray(d.poll.options) ? { options: d.poll.options.map(String), minutes: Number(d.poll.minutes) || 1440 } : null,
          replySettings: d.replySettings || 'everyone',
          updatedAt: Number(d.updatedAt) || 0,
        }
      }
      if (drafts[s.currentId] && !drafts[s.currentId].replyTo) return { currentId: s.currentId, drafts }
      const id = mkId()
      return { currentId: id, drafts: { ...drafts, [id]: newDraft(id) } }
    }
  } catch {}
  return initial(mkId())
}

// "New post": the current draft, if it holds anything, stays in the list.
export function startNew(state: DraftState, id: string): DraftState {
  const drafts = { ...state.drafts }
  if (isEmpty(drafts[state.currentId])) delete drafts[state.currentId]
  drafts[id] = newDraft(id)
  return { currentId: id, drafts }
}

export function open(state: DraftState, id: string): DraftState {
  if (!state.drafts[id] || id === state.currentId) return state
  const drafts = { ...state.drafts }
  if (isEmpty(drafts[state.currentId])) delete drafts[state.currentId]
  return { currentId: id, drafts }
}

// Removing the current draft leaves a blank one in its place.
export function remove(state: DraftState, id: string, freshId: string): DraftState {
  const drafts = { ...state.drafts }
  delete drafts[id]
  if (id !== state.currentId) return { currentId: state.currentId, drafts }
  drafts[freshId] = newDraft(freshId)
  return { currentId: freshId, drafts }
}

export function ensureReply(state: DraftState, notificationId: string): DraftState {
  const id = replyId(notificationId)
  if (state.drafts[id]) return state
  return { ...state, drafts: { ...state.drafts, [id]: newDraft(id, notificationId) } }
}

// The Drafts list: everything with content except the one being written.
export function parked(state: DraftState): Draft[] {
  return Object.values(state.drafts)
    .filter((d) => d.id !== state.currentId && !isEmpty(d))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export function imageIds(state: DraftState): Set<string> {
  const ids = new Set<string>()
  for (const d of Object.values(state.drafts)) for (const p of d.posts) for (const i of p.images) ids.add(i.id)
  return ids
}

export function preview(d: Draft): string {
  const text = d.posts.map((p) => p.text.trim()).find(Boolean)
  if (text) return text
  if (d.posts.some((p) => p.images.length)) return 'Images, no text yet'
  return 'Poll, no text yet'
}

export function imageCount(d: Draft): number {
  return d.posts.reduce((n, p) => n + p.images.length, 0)
}
