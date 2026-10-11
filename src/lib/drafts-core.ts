// What a draft is and how drafts change. There is one draft for the Write
// screen, kept until it is sent, plus one per reply box. Pure functions over
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
      return single(s.currentId, drafts, mkId)
    }
  } catch {}
  return initial(mkId())
}

// Removing the current draft leaves a blank one in its place.
export function remove(state: DraftState, id: string, freshId: string): DraftState {
  const drafts = { ...state.drafts }
  delete drafts[id]
  if (id !== state.currentId) return { currentId: state.currentId, drafts }
  drafts[freshId] = newDraft(freshId)
  return { currentId: freshId, drafts }
}

// One Write draft. Storage from when there could be several keeps the one
// being written, or if that is blank, the most recent one with anything in
// it. Reply drafts are kept as they are.
function single(currentId: string, drafts: Record<string, Draft>, mkId: () => string): DraftState {
  const replies = Object.fromEntries(Object.entries(drafts).filter(([, d]) => d.replyTo))
  const main = Object.values(drafts).filter((d) => !d.replyTo)
  const current = drafts[currentId] && !drafts[currentId].replyTo ? drafts[currentId] : undefined
  const keep = current && !isEmpty(current) ? current : main.filter((d) => !isEmpty(d)).sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? current
  if (keep) return { currentId: keep.id, drafts: { ...replies, [keep.id]: keep } }
  const id = mkId()
  return { currentId: id, drafts: { ...replies, [id]: newDraft(id) } }
}

export function ensureReply(state: DraftState, notificationId: string): DraftState {
  const id = replyId(notificationId)
  if (state.drafts[id]) return state
  return { ...state, drafts: { ...state.drafts, [id]: newDraft(id, notificationId) } }
}

export function imageIds(state: DraftState): Set<string> {
  const ids = new Set<string>()
  for (const d of Object.values(state.drafts)) for (const p of d.posts) for (const i of p.images) ids.add(i.id)
  return ids
}
