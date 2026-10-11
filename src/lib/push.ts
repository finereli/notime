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

export async function enablePush(): Promise<PushState> {
  const { key } = await apiJson<{ key: string }>('/api/push/key')
  if ((await Notification.requestPermission()) !== 'granted') return pushState()
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) })
  await apiJson('/api/push/subscribe', { method: 'POST', body: sub.toJSON() as Record<string, unknown> })
  return 'on'
}

export async function disablePush(): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (sub) {
    await apiJson('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {})
    await sub.unsubscribe()
  }
  return pushState()
}

export const testPush = () => apiJson<{ sent: number; failed: number }>('/api/push/test', { method: 'POST' })
