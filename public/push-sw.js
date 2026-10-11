// Imported by the generated service worker (see vite.config.ts). Shows a
// notification when the server pushes one, and opens the right screen when it
// is tapped.

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

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const w of windows) {
        if ('focus' in w) {
          w.postMessage({ type: 'open', url })
          return w.focus()
        }
      }
      return self.clients.openWindow(url)
    })()
  )
})
