import { fail, json, type Env } from './env'
import { appOrigin, isDev } from './dev'
import { bearer, createSession, deleteSession, validateSession } from './sessions'
import { NeedsLogin, RefreshRejected, SCOPES, beginLogin, d1TokenStore, exchangeCode, freshToken, refreshGrant, takeVerifier, type TokenSet } from './oauth'
import { XError, fakeX, realX, type PostBody, type X, type XUser } from './x'
import { crcResponse, verifySignature } from './webhook'
import { backfill, badge, checkBalance, lookPost, syncStats, syncLikes, chainOf, getNotification, getSetting, hydrate, ingestEvent, listConversations, listMessages, listNotifications, listOwnPosts, realSpend, saveDm, savePosts, saveUsers, setSetting, syncDms, syncOwnPosts, unreadCount, unreadDms } from './store'
import { pushRoutes } from './push-routes'
import { SETUP_VERSION, repair, status } from './setup'
import { monthToDate } from './usage'
import { mcpRequest } from './mcp'
import { approve, authorize, bearerOk, discovery, listClients, pendingExists, preflight, register, revoke, token as oauthToken, unauthorized } from './mcp-auth'

interface Account { x_user_id: string; username: string; name: string | null; avatar: string | null; needs_login: number }

const account = (db: D1Database) =>
  db.prepare(`SELECT x_user_id, username, name, avatar, needs_login FROM account WHERE id = 1`).first<Account>()

async function saveAccount(db: D1Database, me: XUser, t: TokenSet): Promise<void> {
  await db
    .prepare(`INSERT INTO account (id, x_user_id, username, name, avatar, access_token, refresh_token, expires_at, needs_login)
              VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)
              ON CONFLICT(id) DO UPDATE SET x_user_id = ?1, username = ?2, name = ?3, avatar = ?4, access_token = ?5,
                refresh_token = ?6, expires_at = ?7, needs_login = 0, updated_at = datetime('now')`)
    .bind(me.id, me.username, me.name, me.profile_image_url ?? null, t.access_token, t.refresh_token, Date.now() + t.expires_in * 1000)
    .run()
}

const page = (title: string, body: string, status = 200) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<body style="font:16px/1.5 -apple-system,system-ui,sans-serif;background:#f4f6f3;color:#1c2622;display:grid;place-items:center;min-height:90vh;margin:0;padding:24px">
<div style="max-width:22rem"><h1 style="font-size:1.3rem;font-weight:500">${title}</h1><p>${body}</p><p><a href="/" style="color:#2e6b5e">Back to notime</a></p></div>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    const p = url.pathname
    if (!p.startsWith('/api/') && p !== '/mcp' && !p.startsWith('/oauth/') && !p.startsWith('/.well-known/oauth') && p !== '/.well-known/openid-configuration') return env.ASSETS.fetch(request)
    try {
      return await route(request, env, ctx, url)
    } catch (e) {
      if (e instanceof NeedsLogin) return fail('x_login_required', 401)
      if (e instanceof XError) return fail(e.detail, e.status === 401 ? 502 : 422)
      console.error('unhandled', e)
      return fail('Something went wrong on the server', 500)
    }
  },
} satisfies ExportedHandler<Env>

async function route(request: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
  const { pathname } = url
  const method = request.method
  const dev = isDev(env, url)
  const origin = appOrigin(env, url)
  const x: X = dev ? fakeX(env) : realX(env)
  const db = env.DB
  const token = () => (dev ? Promise.resolve('dev') : freshToken(d1TokenStore(db), (rt) => refreshGrant(env, rt)))

  // --- the webhook: X is the caller, the signature is the credential --------
  if (pathname === '/api/webhook/x') {
    if (method === 'GET') {
      const crc = url.searchParams.get('crc_token')
      if (!crc) return fail('crc_token missing')
      return json(await crcResponse(env.X_CLIENT_SECRET, crc))
    }
    if (method !== 'POST') return fail('method not allowed', 405)
    const raw = new Uint8Array(await request.arrayBuffer())
    if (!(await verifySignature(raw, request.headers, env.X_CLIENT_SECRET, env.X_CONSUMER_SECRET))) return fail('bad signature', 403)
    let body: any = null
    try { body = JSON.parse(new TextDecoder().decode(raw)) } catch {}
    const events = Array.isArray(body?.data) ? body.data : body?.data ? [body.data] : []
    // Answer first. X gives us ten seconds and the push fan-out can be slow.
    ctx.waitUntil(
      (async () => {
        const acct = await account(db)
        if (!acct) return
        for (const ev of events) {
          try { await ingestEvent(env, x, token, ev, acct.x_user_id) } catch (e) { console.error('event failed', e) }
        }
      })(),
    )
    return json({ ok: true })
  }

  // --- MCP: an agent reading notime, with OAuth in front -----------------------
  if (method === 'OPTIONS' && (pathname === '/mcp' || pathname.startsWith('/oauth/'))) return preflight()
  const doc = discovery(pathname, origin)
  if (doc) return doc
  if (pathname === '/oauth/register' && method === 'POST') return register(request, db)
  if (pathname === '/oauth/authorize' && method === 'GET') return authorize(url, db)
  if (pathname === '/oauth/token' && method === 'POST') return oauthToken(request, db)
  if (pathname === '/oauth/continue' && method === 'GET') {
    // Approving is signing in with X as the owner. Locally, the stand-in X
    // has nothing to check, so the request is approved on the spot.
    const pending = url.searchParams.get('p') ?? ''
    if (!(await pendingExists(db, pending))) return page('That request expired', 'Start again from the app that asked.', 400)
    if (dev) return approve(db, pending)
    return Response.redirect(await beginLogin(env, origin, pending), 302)
  }
  if (pathname === '/mcp') {
    if (!(await bearerOk(request, db))) return unauthorized(origin)
    const acct = await account(db)
    if (!acct || acct.needs_login) return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'notime needs its owner to sign in to X again' } }, { status: 503 })
    return mcpRequest(request, { env, x, token, ownerId: acct.x_user_id, username: acct.username })
  }

  // --- signing in -----------------------------------------------------------
  if (pathname === '/api/auth/login') {
    if (dev) {
      // Local development: skip X entirely and sign in as a stand-in owner.
      await saveAccount(db, await x.me('dev'), { access_token: 'dev', refresh_token: 'dev', expires_in: 10 * 365 * 86400 })
      await setSetting(db, 'granted_scopes', SCOPES)
      ctx.waitUntil(backfill(env, x, 'dev', '1000').catch(() => {}))
      return Response.redirect(`${origin}/#/signin/${await createSession(db)}`, 302)
    }
    return Response.redirect(await beginLogin(env, origin), 302)
  }

  if (pathname === '/api/auth/callback') {
    const code = url.searchParams.get('code')
    const login = await takeVerifier(db, url.searchParams.get('state') || '')
    const verifier = login?.verifier
    if (!code || !verifier) return page('Sign in did not finish', url.searchParams.get('error') === 'access_denied' ? 'You cancelled at X.' : 'The sign in link expired. Try again.', 400)
    let tokens: TokenSet
    try {
      tokens = await exchangeCode(env, origin, code, verifier)
    } catch (e) {
      return page('Sign in did not finish', `X refused the sign in: ${e instanceof RefreshRejected || e instanceof Error ? e.message : 'unknown error'}`, 400)
    }
    const me = await realX(env).me(tokens.access_token)
    // The whole app runs on the owner's API credit. Nobody else gets in.
    if (me.username.toLowerCase() !== env.OWNER_USERNAME.toLowerCase()) return page('This app is private', `It belongs to @${env.OWNER_USERNAME} and works only with that account.`, 403)
    await saveAccount(db, me, tokens)
    // Remember what X granted, so the app can say when a newer feature needs
    // signing in again.
    await setSetting(db, 'granted_scopes', (tokens as TokenSet & { scope?: string }).scope ?? SCOPES)
    // This sign-in was the owner approving an agent: send the agent its code.
    if (login.mcp) return approve(db, login.mcp)
    ctx.waitUntil(
      (async () => {
        await repair(env, x, tokens.access_token, origin, me.id).catch((e) => console.error('repair failed', e))
        await backfill(env, x, tokens.access_token, me.id).catch((e) => console.error('backfill failed', e))
        await syncLikes(env, x, tokens.access_token, me.id).catch((e) => console.error('likes failed', e))
        await setSetting(db, 'setup_version', SETUP_VERSION)
      })(),
    )
    return Response.redirect(`${origin}/#/signin/${await createSession(db)}`, 302)
  }

  // Push: a device's subscription (kit push/). Renew comes from the service
  // worker without a session, so this runs before the session check.
  if (pathname.startsWith('/api/push/')) {
    const r = await pushRoutes({
      request, url, db, vapid: env,
      signedIn: await validateSession(db, bearer(request)),
      testPayload: async () => ({ title: 'notime', body: 'Notifications work on this device.', tag: 'test', url: '/#/notifications', unread: await badge(db) }),
    })
    if (r) return r
  }

  // --- everything below needs a session -------------------------------------
  const session = bearer(request)
  if (!(await validateSession(db, session))) return fail('unauthorized', 401)

  if (pathname === '/api/auth/logout' && method === 'POST') {
    await deleteSession(db, session)
    return json({ ok: true })
  }

  const acct = await account(db)
  if (!acct) return fail('unauthorized', 401)
  if (acct.needs_login) return fail('x_login_required', 401)

  // Long posts come with Premium. X is asked once and the answer kept. When
  // X will not say, the composer lets a long post through and X decides.
  async function longPosts(): Promise<boolean> {
    let seen = await getSetting(db, 'long_posts_seen')
    if (seen === null) {
      const answer = await x.longPosts(await token()).catch(() => null)
      seen = answer === null ? '?' : answer ? '1' : '0'
      await setSetting(db, 'long_posts_seen', seen)
    }
    return seen !== '0'
  }

  // Scopes the app asks for now that the stored grant lacks.
  async function missingScopes(): Promise<string[]> {
    const granted = new Set(((await getSetting(db, 'granted_scopes')) ?? '').split(/\s+/))
    return SCOPES.split(' ').filter((s) => !granted.has(s))
  }

  // A deploy that changes what the app subscribes to fixes the subscriptions
  // itself, on the next visit, instead of waiting for a sign in or Repair.
  if (pathname === '/api/me' && (await getSetting(db, 'setup_version')) !== SETUP_VERSION) {
    await setSetting(db, 'setup_version', SETUP_VERSION)
    ctx.waitUntil(token().then((t) => repair(env, x, t, origin, acct.x_user_id)).catch((e) => console.error('repair failed', e)))
  }

  if (pathname === '/api/me') {
    return json({
      user: { id: acct.x_user_id, username: acct.username, name: acct.name, avatar: acct.avatar },
      unread: await unreadCount(db),
      unreadDms: await unreadDms(db),
      longPosts: await longPosts(),
      missingScopes: await missingScopes(),
    })
  }

  // --- notifications --------------------------------------------------------
  if (pathname === '/api/notifications' && method === 'GET') {
    const limit = Math.min(Number(url.searchParams.get('limit')) || 40, 100)
    // The first page is when the like counts are worth a fresh look.
    if (!url.searchParams.get('before')) await syncStats(env, x, await token(), acct.x_user_id).catch((e) => console.error('stats failed', e))
    const { items, more } = await listNotifications(db, url.searchParams.get('before'), limit)
    return json({ items, unread: await unreadCount(db), more })
  }

  if (pathname === '/api/notifications/read' && method === 'POST') {
    await db.prepare(`UPDATE notifications SET read = 1 WHERE read = 0`).run()
    await setSetting(db, 'activity_seen_at', new Date().toISOString())
    return json({ ok: true })
  }

  if (pathname === '/api/notifications/check' && method === 'POST') {
    await syncStats(env, x, await token(), acct.x_user_id, true).catch((e) => console.error('stats failed', e))
    return json({ added: await backfill(env, x, await token(), acct.x_user_id) })
  }

  const like = pathname.match(/^\/api\/notifications\/(.+)\/like$/)
  if (like && (method === 'POST' || method === 'DELETE')) {
    const row = await getNotification(db, decodeURIComponent(like[1]))
    if (!row?.post_id) return fail('not found', 404)
    const on = method === 'POST'
    try {
      if (on) await x.like(await token(), acct.x_user_id, row.post_id)
      else await x.unlike(await token(), acct.x_user_id, row.post_id)
    } catch (e) {
      if (e instanceof XError && e.status === 403 && (await missingScopes()).includes('like.write')) return fail('needs_scopes', 403)
      throw e
    }
    await db.prepare(`UPDATE notifications SET liked = ?1, read = 1 WHERE id = ?2`).bind(on ? 1 : 0, row.id).run()
    return json({ liked: on })
  }

  if (pathname.startsWith('/api/notifications/') && method === 'GET') {
    const id = decodeURIComponent(pathname.slice('/api/notifications/'.length))
    let row = await getNotification(db, id)
    if (!row) return fail('not found', 404)
    if (!row.username || (row.target_post_id && (row.target_text == null || row.prev_id == null))) {
      await hydrate(env, x, await token(), row as any)
      row = (await getNotification(db, id))!
    }
    return json({ ...row, chain: await chainOf(db, row) })
  }

  // --- posting --------------------------------------------------------------
  if (pathname === '/api/media' && method === 'POST') {
    const form = await request.formData()
    const file = form.get('file')
    if (!file || typeof file === 'string') return fail('file missing')
    const t = await token()
    const id = await x.uploadMedia(t, file as unknown as Blob)
    const alt = String(form.get('alt') || '').trim()
    let altError: string | undefined
    if (alt) {
      try { await x.setAltText(t, id, alt.slice(0, 1000)) } catch (e) { altError = e instanceof XError ? e.detail : 'could not set the description' }
    }
    return json({ id, altError })
  }

  if (pathname === '/api/posts' && method === 'POST') {
    const b = (await request.json()) as {
      text?: string; media_ids?: string[]; poll?: { options: string[]; minutes: number } | null
      reply_settings?: string; reply_to?: string; quote_post_id?: string; notification_id?: string
    }
    const body: PostBody = {}
    if (b.text) body.text = b.text
    if (b.media_ids?.length) body.media = { media_ids: b.media_ids.slice(0, 4) }
    if (b.poll?.options?.length) body.poll = { options: b.poll.options, duration_minutes: b.poll.minutes }
    if (b.reply_settings && b.reply_settings !== 'everyone') body.reply_settings = b.reply_settings
    if (b.reply_to) body.reply = { in_reply_to_tweet_id: b.reply_to }
    if (b.quote_post_id) body.quote_tweet_id = b.quote_post_id
    if (!body.text && !body.media) return fail('Write something first')
    const post = await x.createPost(await token(), body)
    // Remember what we just said, so the list of past posts costs nothing to keep current.
    await savePosts(db, [{ id: post.id, text: body.text ?? '', author_id: acct.x_user_id, created_at: new Date().toISOString(), reply_to: b.reply_to ?? '' }])
    if (b.notification_id) await db.prepare(`UPDATE notifications SET replied_post_id = ?1 WHERE id = ?2`).bind(post.id, b.notification_id).run()
    ctx.waitUntil(token().then((t) => checkBalance(env, x, t, 3600_000)).catch(() => {}))
    return json({ id: post.id, url: `https://x.com/${acct.username}/status/${post.id}` })
  }

  if (pathname === '/api/posts' && method === 'GET') {
    const limit = 30
    const { items, synced } = await listOwnPosts(db, acct.x_user_id, url.searchParams.get('before'), limit)
    return json({ items, synced, more: items.length === limit })
  }

  if (pathname === '/api/posts/sync' && method === 'POST') {
    const b = (await request.json().catch(() => ({}))) as { older?: boolean }
    return json({ added: await syncOwnPosts(env, x, await token(), acct.x_user_id, !!b.older) })
  }

  // Any post, by id: ours, or one a link points at. Kept once looked up.
  const anyPost = pathname.match(/^\/api\/(x\/)?posts\/(\d+)$/)
  if (anyPost && method === 'GET') {
    const row = await lookPost(env, x, token, anyPost[2])
    if (!row || (!anyPost[1] && row.author_id !== acct.x_user_id)) return fail('not found', 404)
    return json(row)
  }

  // --- direct messages ------------------------------------------------------
  if (pathname === '/api/dms' && method === 'GET') {
    // The first visit fills the list from X; after that the webhook keeps it.
    if ((await getSetting(db, 'dms_synced')) === null) await syncDms(env, x, await token(), acct.x_user_id).catch(() => 0)
    return json({ items: await listConversations(db), unread: await unreadDms(db) })
  }

  if (pathname === '/api/dms/find' && method === 'POST') {
    const b = (await request.json()) as { username?: string }
    const name = String(b.username ?? '').trim().replace(/^@/, '')
    if (!/^\w{1,15}$/.test(name)) return fail('That is not an X username')
    const known = await db.prepare(`SELECT id, username, name, avatar FROM x_users WHERE lower(username) = lower(?1)`).bind(name).first()
    if (known) return json(known)
    const u = await x.findUser(await token(), name)
    if (!u) return fail(`There is no @${name} on X`, 404)
    await saveUsers(db, [u])
    return json({ id: u.id, username: u.username, name: u.name, avatar: u.profile_image_url ?? null })
  }

  const dm = pathname.match(/^\/api\/dms\/(\d+)(\/read|\/sync)?$/)
  if (dm) {
    const partner = dm[1]
    const who = () => db.prepare(`SELECT id, username, name, avatar FROM x_users WHERE id = ?1`).bind(partner).first()
    if (dm[2] === '/read' && method === 'POST') {
      await db.prepare(`UPDATE dms SET read = 1 WHERE partner_id = ?1 AND read = 0`).bind(partner).run()
      return json({ unread: await unreadDms(db) })
    }
    if (dm[2] === '/sync' && method === 'POST') {
      return json({ added: await syncDms(env, x, await token(), acct.x_user_id, partner) })
    }
    if (!dm[2] && method === 'GET') {
      let user = await who()
      if (!user) {
        const u = await x.getUser(await token(), partner).catch(() => null)
        if (u) await saveUsers(db, [u])
        user = await who()
      }
      return json({ user, items: await listMessages(db, partner) })
    }
    if (!dm[2] && method === 'POST') {
      const b = (await request.json()) as { text?: string }
      const text = String(b.text ?? '').trim()
      if (!text) return fail('Write something first')
      if (text.length > 10000) return fail('Messages stop at 10,000 characters')
      let m
      try {
        m = await x.sendDm(await token(), acct.x_user_id, partner, text)
      } catch (e) {
        if (e instanceof XError && e.status === 403 && (await missingScopes()).includes('dm.write')) return fail('needs_scopes', 403)
        throw e
      }
      await saveDm(db, m, acct.x_user_id)
      return json(m)
    }
  }

  // --- what the phone saw when the whole app moved (src/lib/layout-watch.ts) --
  if (pathname === '/api/client-log' && method === 'POST') {
    const body = await request.text()
    await db.batch([
      db.prepare(`INSERT INTO layout_log (data) VALUES (?1)`).bind(body.slice(0, 4000)),
      db.prepare(`DELETE FROM layout_log WHERE id <= (SELECT MAX(id) - 200 FROM layout_log)`),
    ])
    return json({ ok: true })
  }

  // --- agents with MCP access -----------------------------------------------
  if (pathname === '/api/mcp/clients' && method === 'GET') return json({ items: await listClients(db), url: `${origin}/mcp` })
  if (pathname === '/api/mcp/revoke' && method === 'POST') {
    const b = (await request.json()) as { id?: string }
    if (b.id) await revoke(db, b.id)
    return json({ ok: true })
  }

  // --- plumbing -------------------------------------------------------------
  if (pathname === '/api/setup/status') return json(await status(env, x, await token(), origin))
  if (pathname === '/api/setup/repair' && method === 'POST') return json(await repair(env, x, await token(), origin, acct.x_user_id))
  if (pathname === '/api/usage') return json({ ...(await monthToDate(db)), ...(await realSpend(env, x, await token())) })

  return fail('not found', 404)
}
