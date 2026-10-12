import { apiJson } from './api'
import { auth } from './auth.svelte'
import type { Extra } from './rich'

export interface OwnPost { id: string; text: string; created_at: string | null; extra?: Extra | null }
interface Page { items: OwnPost[]; synced: boolean; more: boolean }

// An X id carries its own timestamp. Useful when a cached post came without one.
export const postTime = (p: OwnPost): string =>
  p.created_at ?? new Date(Number((BigInt(p.id) >> 22n) + 1288834974657n)).toISOString()

// The owner's past posts. The list is read from our database; only `sync`
// asks X, and it asks for no more than what is new or one page further back.
class Posts {
  items = $state<OwnPost[]>([])
  loaded = $state(false)
  failed = $state(false)
  more = $state(false)
  syncing = $state(false)

  // Set once X has nothing older to give. Until then there is always more.
  #exhausted = false

  constructor() {
    auth.onChange(() => { this.items = []; this.loaded = false; this.#exhausted = false })
  }

  async load() {
    try {
      let page = await apiJson<Page>('/api/posts')
      // First visit ever: there is nothing to show until X has been asked once.
      if (!page.synced) {
        await this.#sync(false)
        page = await apiJson<Page>('/api/posts')
      }
      this.items = page.items
      this.more = page.more || !this.#exhausted
      this.loaded = true
      this.failed = false
    } catch {
      this.failed = !this.loaded
    }
  }

  async refresh(): Promise<number> {
    const added = await this.#sync(false)
    await this.load()
    return added
  }

  // Earlier posts: first whatever we already hold, then pages from X. A page
  // from X can be all replies, which this list leaves out, so keep going
  // (a few pages at most, two cents each) until something shows.
  async earlier() {
    const last = this.items[this.items.length - 1]
    if (!last) return
    for (let tries = 0; tries < 5; tries++) {
      const page = await apiJson<Page>(`/api/posts?before=${last.id}`)
      if (page.items.length) {
        this.items = [...this.items, ...page.items]
        this.more = page.more || !this.#exhausted
        return
      }
      if (this.#exhausted || !(await this.#sync(true))) break
    }
    this.#exhausted = true
    this.more = false
  }

  async #sync(older: boolean): Promise<number> {
    this.syncing = true
    try {
      return (await apiJson<{ added: number }>('/api/posts/sync', { method: 'POST', body: { older } })).added
    } finally {
      this.syncing = false
    }
  }
}

export const posts = new Posts()
