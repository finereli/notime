// pwa-kit: push/functions/push-routes.ts v1
// The server side of a device's subscription, as one function a Worker or a
// Pages Function calls before its other routes:
//
//   const r = await pushRoutes({ request, url, db: env.DB, vapid: env, signedIn: await validSession(...) })
//   if (r) return r
//
//   GET  /api/push/key          the VAPID public key the client subscribes with
//   POST /api/push/subscribe    store (upsert) a subscription        signed in
//   POST /api/push/unsubscribe  forget one                           signed in
//   POST /api/push/test         push to every device                 signed in
//   POST /api/push/renew        swap a subscription the browser replaced
//
// Renew comes from the service worker, which has no session. It is accepted
// only as a replacement for an endpoint already stored: knowing a live
// endpoint is the proof. Single-user apps store subscriptions in one table;
// a multi-user app adds a user column and filters by it here and in fanOut.

import { fanOut, type Vapid } from './web-push'

interface Opts {
  request: Request
  url: URL
  db: D1Database
  vapid: Vapid
  signedIn: boolean
  // What the test push says. Seam: titles, deep link, the badge count.
  testPayload?: () => Promise<Record<string, unknown>> | Record<string, unknown>
}

const ok = (data: unknown, status = 200) => Response.json(data, { status })

export async function pushRoutes({ request, url, db, vapid, signedIn, testPayload }: Opts): Promise<Response | null> {
  const path = url.pathname
  if (!path.startsWith('/api/push/')) return null
  const post = request.method === 'POST'

  if (path === '/api/push/renew' && post) {
    const b = (await request.json().catch(() => ({}))) as { old?: string; sub?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } } }
    const s = b.sub
    if (!b.old || !s?.endpoint || !s.keys?.p256dh || !s.keys?.auth) return ok({ error: 'bad subscription' }, 400)
    if (!(await db.prepare(`SELECT 1 AS ok FROM push_subs WHERE endpoint = ?1`).bind(b.old).first())) return ok({ error: 'unknown subscription' }, 404)
    await db.batch([
      db.prepare(`DELETE FROM push_subs WHERE endpoint = ?1`).bind(b.old),
      db.prepare(`INSERT INTO push_subs (endpoint, p256dh, auth) VALUES (?1, ?2, ?3) ON CONFLICT(endpoint) DO UPDATE SET p256dh = ?2, auth = ?3`).bind(s.endpoint, s.keys.p256dh, s.keys.auth),
    ])
    return ok({ ok: true })
  }

  if (path === '/api/push/key') return ok({ key: vapid.VAPID_PUBLIC_KEY })
  if (!signedIn) return ok({ error: 'unauthorized' }, 401)

  if (path === '/api/push/subscribe' && post) {
    const s = (await request.json()) as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
    if (!s.endpoint || !s.keys?.p256dh || !s.keys?.auth) return ok({ error: 'bad subscription' }, 400)
    await db
      .prepare(`INSERT INTO push_subs (endpoint, p256dh, auth) VALUES (?1, ?2, ?3) ON CONFLICT(endpoint) DO UPDATE SET p256dh = ?2, auth = ?3`)
      .bind(s.endpoint, s.keys.p256dh, s.keys.auth)
      .run()
    return ok({ ok: true })
  }

  if (path === '/api/push/unsubscribe' && post) {
    const s = (await request.json()) as { endpoint?: string }
    await db.prepare(`DELETE FROM push_subs WHERE endpoint = ?1`).bind(s.endpoint ?? '').run()
    return ok({ ok: true })
  }

  if (path === '/api/push/test' && post) {
    const payload = (await testPayload?.()) ?? { title: 'Notifications work', body: 'This device will get them.', tag: 'test', url: '/' }
    return ok(await fanOut(db, payload, vapid))
  }

  return ok({ error: 'not found' }, 404)
}
