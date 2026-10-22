import { apiJson } from './api'
import { auth } from './auth.svelte'
import { notifications } from './notifications.svelte'
import type { Extra } from './rich'

export interface Person { id: string; username: string | null; name: string | null; avatar: string | null }
export interface Conversation extends Omit<Person, 'id'> { partner_id: string; text: string; sender_id: string; created_at: string; unread: number; extra?: Extra | null }
export interface Message { id: string; sender_id: string; text: string; created_at: string; extra?: Extra | null; pending?: boolean; failed?: string }

// Direct messages. The lists are read from our own database, which X's
// webhook keeps current, so opening them is free. Asking X directly costs a
// cent a message: it happens once to fill the list, and inside a
// conversation only when asked for earlier messages.
class Dms {
  items = $state<Conversation[]>([])
  unread = $state(0)
  loaded = $state(false)
  // X Chat, the encrypted messages: 'locked' until the PIN is entered in Settings.
  chat = $state<'locked' | 'unlocked' | 'off'>('off')
  failed = $state(false)
  // Bumped on every load, so an open conversation knows to reread itself.
  tick = $state(0)

  constructor() {
    auth.onChange(() => { this.items = []; this.unread = 0; this.loaded = false })
  }

  async load() {
    if (!auth.signedIn) return
    try {
      const page = await apiJson<{ items: Conversation[]; unread: number; chat?: 'locked' | 'unlocked' | 'off' }>('/api/dms')
      this.items = page.items
      this.chat = page.chat ?? 'off'
      this.#setUnread(page.unread)
      this.loaded = true
      this.failed = false
      this.tick++
    } catch {
      this.failed = !this.loaded
    }
  }

  #setUnread(n: number) {
    this.unread = n
    notifications.setUnread(notifications.unread, n)
  }

  async markRead(partnerId: string) {
    const c = this.items.find((i) => i.partner_id === partnerId)
    if (c) c.unread = 0
    try {
      this.#setUnread((await apiJson<{ unread: number }>(`/api/dms/${partnerId}/read`, { method: 'POST' })).unread)
    } catch {}
  }
}

export const dms = new Dms()

// What you were typing to someone, kept on the device until it is sent.
const DRAFT_KEY = 'notime.dm-drafts.v1'
export function dmDraft(partnerId: string): string {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}')[partnerId] ?? '' } catch { return '' }
}
export function saveDmDraft(partnerId: string, text: string) {
  try {
    const all = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}')
    if (text) all[partnerId] = text
    else delete all[partnerId]
    localStorage.setItem(DRAFT_KEY, JSON.stringify(all))
  } catch {}
}
