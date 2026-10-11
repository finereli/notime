// The one auth instance. The session token is the credential, kept in
// localStorage and sent as a bearer. Signing in is a round trip to X, so the
// route the user was on is parked in sessionStorage and restored on return.

export interface User { id: string; username: string; name: string | null; avatar: string | null }

const TOKEN_KEY = 'notime.session.v1'
const USER_KEY = 'notime.user.v1'
const RETURN_KEY = 'notime.return.v1'

class Auth {
  token = $state<string | undefined>(undefined)
  user = $state<User | null>(null)
  #listeners: Array<() => void> = []

  get signedIn() { return !!this.token }

  // Synchronous on purpose: a returning user must never see the login screen
  // flash by before the app.
  init() {
    const arrived = location.hash.match(/^#\/signin\/(sess_[0-9a-f]{64})$/)
    if (arrived) {
      localStorage.setItem(TOKEN_KEY, arrived[1])
      const back = sessionStorage.getItem(RETURN_KEY) || '/'
      sessionStorage.removeItem(RETURN_KEY)
      history.replaceState(null, '', '#' + back)
    }
    this.token = localStorage.getItem(TOKEN_KEY) || undefined
    try { this.user = JSON.parse(localStorage.getItem(USER_KEY) || 'null') } catch { this.user = null }
  }

  setUser(user: User) {
    this.user = user
    localStorage.setItem(USER_KEY, JSON.stringify(user))
  }

  signIn() {
    const here = location.hash.replace(/^#/, '')
    if (here && !here.startsWith('/signin')) sessionStorage.setItem(RETURN_KEY, here)
    location.href = '/api/auth/login'
  }

  async signOut() {
    const token = this.token
    this.#clear()
    if (token) await fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {})
  }

  // Every 401 from the API lands here. Drafts live on the device, so nothing
  // the user wrote is lost by being sent back to the login screen.
  handleUnauthorized() { this.#clear() }

  onChange(fn: () => void) { this.#listeners.push(fn) }

  #clear() {
    this.token = undefined
    this.user = null
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    for (const fn of this.#listeners) fn()
  }
}

export const auth = new Auth()
