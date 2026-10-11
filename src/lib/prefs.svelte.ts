// Account-level choices the composer needs before the server has answered,
// so the last known value is kept on the device.

const KEY = 'notime.prefs.v1'

class Prefs {
  longPosts = $state(false)
  longPostsFrom = $state<'you' | 'x' | 'unknown'>('unknown')

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || '{}')
      this.longPosts = !!saved.longPosts
      if (saved.longPostsFrom) this.longPostsFrom = saved.longPostsFrom
    } catch {}
  }

  set(longPosts: boolean, from: 'you' | 'x' | 'unknown') {
    this.longPosts = longPosts
    this.longPostsFrom = from
    localStorage.setItem(KEY, JSON.stringify({ longPosts, longPostsFrom: from }))
  }
}

export const prefs = new Prefs()
