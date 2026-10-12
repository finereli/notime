import { apiJson } from './api'

// Push on this device. On an iPhone it only exists once the app has been
// added to the home screen, so that case gets its own state and its own words.

export type PushState = 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on'

const isIos = () => /(iPad|iPhone|iPod)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

export async function pushState(): Promise<PushState> {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  if (!supported) return isIos() && !isStandalone() ? 'needs-install' : 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  return sub && Notification.permission === 'granted' ? 'on' : 'off'
}

function keyBytes(b64u: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64u.replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

// Whether push was turned on for this device. The browser's own subscription
// is not enough to go by: it dies with the service worker, which the reload
// button in the menu removes on purpose, and Chrome can replace it too.
const WANTED = 'notime.push.v1'
const wanted = () => { try { return localStorage.getItem(WANTED) === 'on' } catch { return false } }
const want = (on: boolean) => { try { on ? localStorage.setItem(WANTED, 'on') : localStorage.removeItem(WANTED) } catch {} }

async function subscribe(): Promise<void> {
  const { key } = await apiJson<{ key: string }>('/api/push/key')
  const reg = await navigator.serviceWorker.ready
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }))
  await apiJson('/api/push/subscribe', { method: 'POST', body: sub.toJSON() as Record<string, unknown> })
}

export async function enablePush(): Promise<PushState> {
  if ((await Notification.requestPermission()) !== 'granted') return pushState()
  await subscribe()
  want(true)
  return 'on'
}

// On every launch: if push was on here and the phone still allows it, make
// sure there is a subscription and the server has it. Asking for a new one
// with permission already granted shows no prompt. Telling the server again
// is harmless, and brings back one it dropped.
export async function keepPush(): Promise<void> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || Notification.permission !== 'granted') return
  // Turned on before this flag existed: a live subscription says so.
  if (!wanted() && (await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription())) want(true)
  if (!wanted()) return
  await subscribe().catch(() => {})
}

export async function disablePush(): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (sub) {
    await apiJson('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {})
    await sub.unsubscribe()
  }
  want(false)
  return pushState()
}

export const testPush = () => apiJson<{ sent: number; failed: number }>('/api/push/test', { method: 'POST' })
