// The list shows replies, mentions and quotes, because each wants an answer.
// A back-and-forth with one person is one conversation: when someone answers
// your answer to them, the newer reply carries the earlier ones and the
// earlier ones leave the list. Branches stay separate rows, each with the
// part of the conversation that led to it.

export interface Item {
  id: string
  // likes and follows are cumulative lines: one per post, one for followers.
  type: 'reply' | 'mention' | 'quote' | 'likes' | 'follows'
  actor_id: string
  post_id: string | null
  target_post_id: string | null
  text: string | null
  created_at: string
  read: number
  replied_post_id: string | null
  username: string | null
  name: string | null
  avatar: string | null
  target_text: string | null
  // The earlier notification this one continues, if any.
  prev_id?: string | null
  // Some post of the owner's answers this one (sent here or on X).
  answered?: boolean
  liked?: boolean
  // Cumulative lines only: how many, and the name of the one before the latest.
  count?: number
  second?: string | null
}

export const cumulative = (i: Item) => i.type === 'likes' || i.type === 'follows'

// "Ana Lima", "Ana Lima and Ben", "Ana Lima and 12 others".
export function crowd(i: Item): string {
  const first = displayName(i)
  const n = i.count ?? 1
  if (n <= 1) return first
  if (n === 2 && i.second) return `${first} and ${i.second}`
  return `${first} and ${n - 1} others`
}

// items runs oldest to newest; the last one is what the row shows.
export interface Row { key: string; type: Item['type']; items: Item[]; created_at: string; unread: boolean }

export function collapse(items: Item[]): Row[] {
  const byId = new Map(items.map((i) => [i.id, i]))
  const continued = new Set(items.map((i) => i.prev_id).filter((id): id is string => !!id && byId.has(id)))
  const rows: Row[] = []
  for (const item of items) {
    if (continued.has(item.id)) continue
    const chain = [item]
    let prev = item.prev_id ? byId.get(item.prev_id) : undefined
    while (prev && !chain.includes(prev)) {
      chain.unshift(prev)
      prev = prev.prev_id ? byId.get(prev.prev_id) : undefined
    }
    rows.push(row(chain))
  }
  // Whatever no row carries (only possible if X's links ever loop) stands alone.
  const shown = new Set(rows.flatMap((r) => r.items.map((i) => i.id)))
  for (const item of items) if (!shown.has(item.id)) rows.push(row([item]))
  return rows.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
}

function row(chain: Item[]): Row {
  const last = chain[chain.length - 1]
  return { key: last.id, type: last.type, items: chain, created_at: last.created_at, unread: chain.some((i) => !i.read) }
}

export const displayName = (i: Pick<Item, 'name' | 'username'>) => i.name || (i.username ? '@' + i.username : 'Someone')

// Dealt with: answered, or liked (a like is how you say "seen it, no reply").
export const handled = (i: Item) => !!(i.replied_post_id || i.answered || i.liked)

export const VERB: Record<Item['type'], string> = {
  reply: 'replied',
  mention: 'mentioned you',
  quote: 'quoted you',
  likes: 'liked your post',
  follows: 'followed you',
}
