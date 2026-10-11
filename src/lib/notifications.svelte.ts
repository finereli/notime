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
    if (!this.unread) return
    this.setUnread(0)
    await apiJson('/api/notifications/read', { method: 'POST' }).catch(() => {})
  }

  markReplied(id: string, postId: string) {
    this.items = this.items.map((i) => (i.id === id ? { ...i, replied_post_id: postId } : i))
  }

  setUnread(n: number) {
    this.unread = n
    const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
    if (n > 0) nav.setAppBadge?.(n).catch(() => {})
    else nav.clearAppBadge?.().catch(() => {})
  }
}

export const notifications = new Notifications()
