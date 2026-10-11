import { apiJson } from './api'
import { auth } from './auth.svelte'
import type { Item } from './collapse'

interface Page { items: Item[]; unread: number; more: boolean }

// Reads come from our own database, never from X, so refreshing is free.
class Notifications {
  items = $state<Item[]>([])
  unread = $state(0)
  more = $state(false)
  loaded = $state(false)
  failed = $state(false)
  checking = $state(false)

  constructor() {
    auth.onChange(() => { this.items = []; this.unread = 0; this.loaded = false })
  }

  async load() {
    if (!auth.signedIn) return
    try {
      const page = await apiJson<Page>('/api/notifications')
      this.items = page.items
      this.more = page.more
      this.loaded = true
      this.failed = false
      this.setUnread(page.unread)
    } catch {
      this.failed = !this.loaded
    }
  }

  async loadMore() {
    const last = this.items[this.items.length - 1]
    if (!last) return
    const page = await apiJson<Page>(`/api/notifications?before=${encodeURIComponent(last.created_at)}`)
    this.items = [...this.items, ...page.items]
    this.more = page.more
  }

  // Asks X for mentions the webhook may have missed. This one does cost.
  async check(): Promise<number> {
    this.checking = true
    try {
      const { added } = await apiJson<{ added: number }>('/api/notifications/check', { method: 'POST' })
      await this.load()
      return added
    } finally {
      this.checking = false
    }
  }

  async markRead() {
    if (!this.unread && !this.items.some((i) => !i.read)) return
    this.setUnread(0)
    await apiJson('/api/notifications/read', { method: 'POST' }).catch(() => {})
  }

  // The heart: likes the post on X, and marks the row as dealt with. The
  // change shows at once and rolls back if X says no.
  async like(id: string, on: boolean) {
    const set = (v: boolean) => (this.items = this.items.map((i) => (i.id === id ? { ...i, liked: v, read: 1 } : i)))
    set(on)
    try {
      await apiJson(`/api/notifications/${encodeURIComponent(id)}/like`, { method: on ? 'POST' : 'DELETE' })
    } catch (e) {
      set(!on)
      throw e
    }
  }

  markReplied(id: string, postId: string) {
    this.items = this.items.map((i) => (i.id === id ? { ...i, replied_post_id: postId } : i))
  }

  // The app badge counts both: replies waiting and people waiting.
  setUnread(n: number, messages = this.#messages) {
    this.unread = n
    this.#messages = messages
    const total = n + messages
    const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
    if (total > 0) nav.setAppBadge?.(total).catch(() => {})
    else nav.clearAppBadge?.().catch(() => {})
  }
  #messages = 0
}

export const notifications = new Notifications()
