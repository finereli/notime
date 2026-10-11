import type { Env } from './env'
import { b64uEncode, randomToken, utf8 } from './bytes'
import { problemDetail } from './x'

// Log in with X: OAuth 2.0 authorization code with PKCE, as a confidential
// client. offline.access is what gets us a refresh token, which the webhook
// and push need long after the browser tab is gone.

// like.write for the heart; dm.read and dm.write for messages. Adding a scope
// means signing in again: X only grants what was asked for at sign in.
export const SCOPES = 'tweet.read tweet.write users.read media.write offline.access like.write dm.read dm.write'

export interface TokenSet { access_token: string; refresh_token: string; expires_in: number }

export async function beginLogin(env: Env, origin: string): Promise<string> {
  const state = randomToken(24)
  const verifier = randomToken(48)
  const challenge = b64uEncode(await crypto.subtle.digest('SHA-256', utf8(verifier)))
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM oauth_states WHERE created_at < datetime('now', '-1 hour')`),
    env.DB.prepare(`INSERT INTO oauth_states (state, verifier) VALUES (?1, ?2)`).bind(state, verifier),
  ])
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: env.X_CLIENT_ID,
    redirect_uri: origin + '/api/auth/callback',
    scope: SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })
  return 'https://x.com/i/oauth2/authorize?' + q
}

export async function takeVerifier(db: D1Database, state: string): Promise<string | null> {
  const row = await db.prepare(`DELETE FROM oauth_states WHERE state = ?1 RETURNING verifier`).bind(state).first<{ verifier: string }>()
  return row?.verifier ?? null
}

// A refusal means the grant itself is no good. Anything else (a timeout, a
// 500) says nothing about the grant and must not log the owner out.
export class RefreshRejected extends Error {}
export class NeedsLogin extends Error {}

async function tokenRequest(env: Env, params: Record<string, string>): Promise<TokenSet> {
  const res = await fetch('https://api.x.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + btoa(`${env.X_CLIENT_ID}:${env.X_CLIENT_SECRET}`),
    },
    body: new URLSearchParams(params),
  })
  const data: any = await res.json().catch(() => null)
  if (!res.ok || !data?.access_token) {
    const msg = problemDetail(data) || `token endpoint answered ${res.status}`
    if (res.status === 400 || res.status === 401) throw new RefreshRejected(msg)
    throw new Error(msg)
  }
  return data
}

export const exchangeCode = (env: Env, origin: string, code: string, verifier: string) =>
  tokenRequest(env, { grant_type: 'authorization_code', code, redirect_uri: origin + '/api/auth/callback', code_verifier: verifier })

export const refreshGrant = (env: Env, refreshToken: string) =>
  tokenRequest(env, { grant_type: 'refresh_token', refresh_token: refreshToken })

// --- keeping the access token fresh -----------------------------------------

export interface TokenRow { access_token: string; refresh_token: string; expires_at: number; needs_login: number }
export interface TokenStore {
  load(): Promise<TokenRow | null>
  // Writes only if the stored refresh token is still `prev`.
  save(prev: string, next: TokenSet, now: number): Promise<void>
  markNeedsLogin(prev: string): Promise<void>
}

const SKEW_MS = 3 * 60 * 1000

// X refresh tokens are single use. Two requests that both find the access
// token stale will both try to spend the same refresh token, and X refuses the
// second. So a refusal is not proof the grant is dead: first look again, in
// case the other request already stored a new pair.
export async function freshToken(
  store: TokenStore,
  refresh: (refreshToken: string) => Promise<TokenSet>,
  now: () => number = Date.now,
  pause: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<string> {
  const row = await store.load()
  if (!row || row.needs_login) throw new NeedsLogin('Sign in with X again')
  if (row.expires_at - now() > SKEW_MS) return row.access_token
  try {
    const next = await refresh(row.refresh_token)
    await store.save(row.refresh_token, next, now())
    return next.access_token
  } catch (e) {
    if (!(e instanceof RefreshRejected)) throw e
    for (const wait of [0, 400, 1200]) {
      if (wait) await pause(wait)
      const again = await store.load()
      if (again && again.refresh_token !== row.refresh_token && !again.needs_login) return again.access_token
    }
    await store.markNeedsLogin(row.refresh_token)
    throw new NeedsLogin('Sign in with X again')
  }
}

export function d1TokenStore(db: D1Database): TokenStore {
  return {
    load: () => db.prepare(`SELECT access_token, refresh_token, expires_at, needs_login FROM account WHERE id = 1`).first<TokenRow>(),
    async save(prev, next, now) {
      await db
        .prepare(`UPDATE account SET access_token = ?1, refresh_token = ?2, expires_at = ?3, needs_login = 0, updated_at = datetime('now') WHERE id = 1 AND refresh_token = ?4`)
        .bind(next.access_token, next.refresh_token, now + next.expires_in * 1000, prev)
        .run()
    },
    async markNeedsLogin(prev) {
      await db.prepare(`UPDATE account SET needs_login = 1 WHERE id = 1 AND refresh_token = ?1`).bind(prev).run()
    },
  }
}
