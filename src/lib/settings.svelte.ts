import { apiJson } from './api'
import { dms } from './dms.svelte'
import { disablePush, enablePush, pushState, testPush, type PushState } from './push'
import { toasts } from '$shared/lib/toast.svelte'

// What the Settings pages show, held in one place so the index can sum up
// each section and the section pages act on the same state.

export interface Status {
  url: string
  webhook: { id: string; valid: boolean } | null
  webhookError?: string
  subsError?: string
  events: Array<{ type: string; label: string; present: boolean; error?: string }>
  lastEventAt: string | null
}
export interface Usage {
  month: string; total: number; rows: Array<{ kind: string; n: number }>
  credits: { total: number; free: number; prepaid: number; expires?: string } | null
  spent: number; since: string | null; spentMonth: number; low: number
}
export interface ChatState { unlocked: boolean; ready: boolean; synced: string | null }
export interface Agents { url: string; items: Array<{ id: string; name: string | null; created_at: string; last_used: string | null }> }
export interface LogRow { at: string; kind: string; types: string | null; note: string | null }

class Settings {
  push = $state<PushState | null>(null)
  pushBusy = $state(false)
  pushNote = $state('')

  chat = $state<ChatState | null>(null)
  chatBusy = $state(false)
  chatError = $state('')

  status = $state<Status | null>(null)
  statusFailed = $state(false)
  repairing = $state(false)
  replaying = $state(false)
  replayNote = $state('')
  log = $state<LogRow[] | null>(null)

  agents = $state<Agents | null>(null)
  usage = $state<Usage | null>(null)

  // Everything, for the index. Each call is cheap and none of them bill.
  load() {
    pushState().then((s) => (this.push = s))
    apiJson<ChatState>('/api/chat').then((c) => (this.chat = c)).catch(() => {})
    apiJson<Status>('/api/setup/status').then((s) => { this.status = s; this.statusFailed = false }).catch(() => (this.statusFailed = true))
    apiJson<Usage>('/api/usage').then((u) => (this.usage = u)).catch(() => {})
    this.loadAgents()
  }

  loadAgents() {
    return apiJson<Agents>('/api/mcp/clients').then((a) => (this.agents = a)).catch(() => {})
  }

  loadLog() {
    return apiJson<{ items: LogRow[] }>('/api/setup/log').then((r) => (this.log = r.items)).catch(() => {})
  }

  // Status lines sit next to the button that caused them and clear themselves.
  #note(text: string, ms = 5000) {
    this.pushNote = text
    setTimeout(() => { if (this.pushNote === text) this.pushNote = '' }, ms)
  }

  async togglePush() {
    this.pushBusy = true
    try {
      this.push = this.push === 'on' ? await disablePush() : await enablePush()
      if (this.push === 'denied') this.#note('Notifications are blocked for this app in your device settings.')
    } catch (e) {
      this.#note(e instanceof Error ? e.message : 'That did not work')
    } finally {
      this.pushBusy = false
    }
  }

  async sendTest() {
    this.pushBusy = true
    try {
      const r = await testPush()
      this.#note(r.sent ? `Sent to ${r.sent === 1 ? 'one device' : r.sent + ' devices'}.` : 'No device accepted it. Turn notifications on first.')
    } catch {
      this.#note('The test could not be sent.')
    } finally {
      this.pushBusy = false
    }
  }

  async unlockChat(pin: string): Promise<boolean> {
    this.chatBusy = true
    this.chatError = ''
    try {
      await apiJson('/api/chat/unlock', { method: 'POST', body: { pin } })
      this.chat = { ...this.chat!, unlocked: true }
      dms.load()
      return true
    } catch (err) {
      this.chatError = err instanceof Error ? err.message : 'That did not work'
      return false
    } finally {
      this.chatBusy = false
    }
  }

  async lockChat() {
    this.chatBusy = true
    try {
      await apiJson('/api/chat/lock', { method: 'POST' })
      this.chat = { ...this.chat!, unlocked: false, synced: null }
    } catch {
      toasts.error('Could not lock them')
    } finally {
      this.chatBusy = false
    }
  }

  async repair() {
    this.repairing = true
    try {
      this.status = await apiJson<Status>('/api/setup/repair', { method: 'POST' })
    } catch {
      toasts.error('Repair failed')
    } finally {
      this.repairing = false
    }
  }

  async replay() {
    this.replaying = true
    this.replayNote = ''
    try {
      await apiJson('/api/setup/replay', { method: 'POST' })
      this.replayNote = 'X is resending the last 24 hours. Anything you already have is skipped; the rest arrives over the next minutes.'
      setTimeout(() => this.loadLog(), 5000)
    } catch (e) {
      this.replayNote = e instanceof Error ? e.message : 'X did not take the request'
    } finally {
      this.replaying = false
    }
  }

  async revokeAgent(id: string) {
    try {
      await apiJson('/api/mcp/revoke', { method: 'POST', body: { id } })
      await this.loadAgents()
    } catch {
      toasts.error('Could not take access back')
    }
  }

  get healthy() {
    return !!this.status?.webhook?.valid && this.status.events.every((e) => e.present)
  }
}

export const settings = new Settings()

export const money = (n: number) => '$' + n.toFixed(2)
export const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
export const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
