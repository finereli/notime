// What the account can do, kept on the device so the composer knows before
// the server has answered.

const KEY = 'notime.prefs.v2'

class Prefs {
  // Long posts come with Premium. The server asks X; when X will not say,
  // this stays on and X decides when the post is sent.
  longPosts = $state(true)
  // OAuth scopes the app now uses that the current sign in did not grant.
  missingScopes = $state<string[]>([])

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || '{}')
      if (typeof saved.longPosts === 'boolean') this.longPosts = saved.longPosts
      if (Array.isArray(saved.missingScopes)) this.missingScopes = saved.missingScopes
    } catch {}
  }

  set(longPosts: boolean, missingScopes: string[]) {
    this.longPosts = longPosts
    this.missingScopes = missingScopes
    try { localStorage.setItem(KEY, JSON.stringify({ longPosts, missingScopes })) } catch {}
  }
}

export const prefs = new Prefs()

// Errors from the API, in words. needs_scopes means the feature is newer than
// the sign in.
export function explain(e: unknown, fallback = 'That did not work'): string {
  const msg = e instanceof Error ? e.message : ''
  if (msg === 'needs_scopes') return 'Sign in again to allow this. X only grants what the app asked for at sign in.'
  return msg || fallback
}
