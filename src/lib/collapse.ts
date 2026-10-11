// The list shows replies, mentions and quotes one by one, because each wants
// an answer. Reposts of the same post fold into one quiet line. Likes are
// not here at all: there is nothing to do about a like.

export interface Item {
  id: string
  type: 'reply' | 'mention' | 'quote' | 'repost' | 'follow'
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
}

export interface Row { key: string; type: Item['type']; items: Item[]; created_at: string; unread: boolean }

export function collapse(items: Item[]): Row[] {
  const rows: Row[] = []
  const groups = new Map<string, Row>()
  for (const item of items) {
    const groupKey = item.type === 'repost' && item.target_post_id ? `${item.type}:${item.target_post_id}` : null
    const group = groupKey && groups.get(groupKey)
    if (group) {
      if (!group.items.some((i) => i.actor_id === item.actor_id)) group.items.push(item)
      group.unread ||= !item.read
      continue
    }
    const row: Row = { key: groupKey ?? item.id, type: item.type, items: [item], created_at: item.created_at, unread: !item.read }
    if (groupKey) groups.set(groupKey, row)
    rows.push(row)
  }
  return rows
}

export const displayName = (i: Pick<Item, 'name' | 'username'>) => i.name || (i.username ? '@' + i.username : 'Someone')

export function who(row: Row): string {
  const first = displayName(row.items[0])
  const others = row.items.length - 1
  if (others === 0) return first
  if (others === 1) return `${first} and ${displayName(row.items[1])}`
  return `${first} and ${others} others`
}

export const VERB: Record<Item['type'], string> = {
  reply: 'replied',
  mention: 'mentioned you',
  quote: 'quoted you',
  repost: 'reposted you',
  follow: 'followed you',
}
