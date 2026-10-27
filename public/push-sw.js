// pwa-kit: push/public/push-sw.js v2
// Imported by the generated service worker: in vite.config's pwaOptions,
//   workbox: { importScripts: ['/push-sw.js'], globIgnores: [..., '**/push-sw.js'] }
// The browser byte-checks imported scripts on every update check, so a change
// here rides the normal update flow. Shows a notification when the server
// pushes one, opens the right screen when it is tapped, and hands a
// browser-replaced subscription to the server.
//
// Payload: { title, body, tag, url, unread }. url is where a tap goes (a
// hash route works); unread sets the app badge. Seams: the icon and badge
// paths below (the badge is a 72px monochrome glyph, Android's status bar).

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data.json()
  } catch {
    data = { title: 'notime', body: event.data ? event.data.text() : '' }
  }
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(data.title || 'notime', {
        body: data.body || '',
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-72.png',
        tag: data.tag,
        data: { url: data.url || '/' },
        vibrate: [200, 100, 200],
      })
      if (typeof data.unread === 'number' && navigator.setAppBadge) navigator.setAppBadge(data.unread).catch(() => {})
      // An open app refreshes its list without being asked.
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const w of windows) w.postMessage({ type: 'push' })
    })()
  )
})

// The installed app marks its window with ?app and says so once per launch.
// Remembered in a cache, because the service worker itself does not live long.
const MARK = '/__installed'
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'installed') {
    event.waitUntil(caches.open('pwa-installed').then((c) => c.put(MARK, new Response('1'))).catch(() => {}))
  }
})
const installed = () => caches.open('pwa-installed').then((c) => c.match(MARK)).then(Boolean).catch(() => false)
const isApp = (w) => { try { return new URL(w.url).searchParams.has('app') } catch { return false } }

// A tap goes to the installed app when there is one: its open window, or a
// fresh launch (opening an in-scope URL starts the installed app on Android).
// A browser tab is used only when the app is not installed on this device.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    (async () => {
      const windows = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).filter((w) => 'focus' in w)
      const app = windows.find(isApp)
      const target = app || ((await installed()) ? null : windows[0])
      if (target) {
        target.postMessage({ type: 'open', url })
        return target.focus()
      }
      return self.clients.openWindow((await installed()) ? '/?app' + url.replace(/^\/?/, '') : url)
    })()
  )
})

// The browser can replace a subscription on its own. Hand the new one to the
// server, which accepts it in place of the old one it already knows. The app
// also re-registers on every launch, so this only closes the gap until then.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const old = event.oldSubscription
      let sub = event.newSubscription
      if (!sub && old) sub = await self.registration.pushManager.subscribe(old.options)
      if (!sub || !old) return
      await fetch('/api/push/renew', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old: old.endpoint, sub: sub.toJSON() }),
      })
    })().catch(() => {})
  )
})
