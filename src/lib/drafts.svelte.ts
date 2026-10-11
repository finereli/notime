// Everything typed is saved as it is typed and stays on this device until it
// is posted. Text and structure go to localStorage, image bytes to IndexedDB.

import * as core from './drafts-core'
import type { Draft, DraftImage, DraftState } from './drafts-core'
import { deleteImage, getImage, imageKeys, putImage } from './idb'

const KEY = 'notime.drafts.v1'
const DEBOUNCE = 300
const mkId = () => crypto.randomUUID()

class Drafts {
  state = $state<DraftState>(core.load(localStorage.getItem(KEY), mkId))
  #timer: ReturnType<typeof setTimeout> | null = null
  #urls = new Map<string, string>()

  constructor() {
    // A phone can kill the page without warning. Don't leave the last 300ms
    // of typing in a timer.
    addEventListener('pagehide', () => this.flush())
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && this.flush())
    this.#sweep()
  }

  get current(): Draft { return this.state.drafts[this.state.currentId] }
  get parked(): Draft[] { return core.parked(this.state) }

  touch(draft: Draft) {
    draft.updatedAt = Date.now()
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = setTimeout(() => this.flush(), DEBOUNCE)
  }

  flush() {
    if (this.#timer) { clearTimeout(this.#timer); this.#timer = null }
    try { localStorage.setItem(KEY, JSON.stringify(this.state)) } catch {}
  }

  startNew() { this.#set(core.startNew(this.state, mkId())) }
  open(id: string) { this.#set(core.open(this.state, id)) }

  remove(id: string) {
    const images = this.state.drafts[id]?.posts.flatMap((p) => p.images) ?? []
    this.#set(core.remove(this.state, id, mkId()))
    for (const i of images) this.dropImage(i.id)
  }

  reply(notificationId: string): Draft {
    const id = core.replyId(notificationId)
    if (!this.state.drafts[id]) this.#set(core.ensureReply(this.state, notificationId))
    return this.state.drafts[id]
  }

  async addImage(blob: Blob): Promise<DraftImage> {
    const id = mkId()
    await putImage(id, blob)
    this.#urls.set(id, URL.createObjectURL(blob))
    return { id, alt: '' }
  }

  async imageUrl(id: string): Promise<string | null> {
    const have = this.#urls.get(id)
    if (have) return have
    const blob = await getImage(id).catch(() => undefined)
    if (!blob) return null
    const url = URL.createObjectURL(blob)
    this.#urls.set(id, url)
    return url
  }

  imageBlob = (id: string) => getImage(id)

  dropImage(id: string) {
    const url = this.#urls.get(id)
    if (url) { URL.revokeObjectURL(url); this.#urls.delete(id) }
    deleteImage(id).catch(() => {})
  }

  #set(next: DraftState) {
    this.state = next
    this.flush()
  }

  // Blobs whose draft is gone would otherwise sit there forever.
  async #sweep() {
    try {
      const live = core.imageIds(this.state)
      for (const key of await imageKeys()) if (!live.has(key)) await deleteImage(key)
    } catch {}
  }
}

export const drafts = new Drafts()
