import { apiJson } from './api'
import type { Extra } from './rich'

export interface LinkedPost {
  id: string
  text: string
  created_at: string | null
  author_id: string | null
  username: string | null
  name: string | null
  avatar: string | null
  extra: Extra | null
}

// One request per post per session. The server keeps them for good.
const seen = new Map<string, Promise<LinkedPost>>()
export function lookPost(id: string): Promise<LinkedPost> {
  let p = seen.get(id)
  if (!p) {
    p = apiJson<LinkedPost>(`/api/x/posts/${id}`)
    p.catch(() => seen.delete(id))
    seen.set(id, p)
  }
  return p
}
