import { apiJson } from './api'

export interface Person {
  id: string; username: string | null; name: string | null; avatar: string | null
  description: string | null; location: string | null; url: string | null
  followers: number | null; following: number | null; posts: number | null
  i_follow: boolean | null; follows_me: boolean
}

// Whether the owner follows someone, shared by every follow button so they
// agree. Unknown until asked; the server keeps the answer for a day.
class Follows {
  state = $state<Record<string, { on: boolean | null; pending?: boolean }>>({})

  set(id: string, on: boolean | null, pending = false) {
    this.state[id] = { on, pending }
  }

  async learn(id: string) {
    if (this.state[id]) return
    this.state[id] = { on: null }
    try {
      const r = await apiJson<{ user: Person; me: boolean }>(`/api/users/${id}?posts=0`)
      if (!r.me) this.set(id, r.user.i_follow)
    } catch {}
  }

  async toggle(id: string) {
    const was = this.state[id]?.on ?? false
    this.set(id, !was)
    try {
      const r = await apiJson<{ i_follow: boolean; pending: boolean }>(`/api/users/${id}/follow`, { method: was ? 'DELETE' : 'POST' })
      this.set(id, r.i_follow, r.pending)
    } catch (e) {
      this.set(id, was)
      throw e
    }
  }
}

export const follows = new Follows()
