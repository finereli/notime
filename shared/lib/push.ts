// pwa-kit: push/lib/push.ts v1
// Push on this device: its state for Settings, turning it on and off, and
// keeping it on. Pass the app's apiJson (kit api/) and a localStorage key:
//
//   export const push = makePush({ apiJson, storageKey: 'myapp.push.v1' })
//   push.keepPush()                       // on every launch, after sign-in
//   await push.enablePush()               // from a button: asks permission
//
// On an iPhone push only exists once the app is on the home screen, so that
// case gets its own state (and its own words in Settings).

export type PushState = 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on'

type ApiJson = <T = unknown>(path: string, opts?: { method?: string; body?: Record<string, unknown> }) => Promise<T>

const isIos = () => /(iPad|iPhone|iPod)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

function keyBytes(b64u: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64u.replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

export function makePush({ apiJson, storageKey }: { apiJson: ApiJson; storageKey: string }) {
  // Whether the user turned push on here. The browser's subscription is not
  // the record of intent: it dies with the service worker (which the reload
  // button's reset() removes on purpose), and Chrome can replace it.
  const wanted = () => { try { return localStorage.getItem(storageKey) === 'on' } catch { return false } }
  const want = (on: boolean) => { try { on ? localStorage.setItem(storageKey, 'on') : localStorage.removeItem(storageKey) } catch {} }

  async function pushState(): Promise<PushState> {
    if (!supported()) return isIos() && !isStandalone() ? 'needs-install' : 'unsupported'
    if (Notification.permission === 'denied') return 'denied'
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = await reg?.pushManager.getSubscription()
    return sub && Notification.permission === 'granted' ? 'on' : 'off'
  }

  async function subscribe(): Promise<void> {
    const { key } = await apiJson<{ key: string }>('/api/push/key')
    const reg = await navigator.serviceWorker.ready
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }))
    await apiJson('/api/push/subscribe', { method: 'POST', body: sub.toJSON() as Record<string, unknown> })
  }

  async function enablePush(): Promise<PushState> {
    if ((await Notification.requestPermission()) !== 'granted') return pushState()
    await subscribe()
    want(true)
    return 'on'
  }

  async function disablePush(): Promise<PushState> {
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = await reg?.pushManager.getSubscription()
    if (sub) {
      await apiJson('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {})
      await sub.unsubscribe()
    }
    want(false)
    return pushState()
  }

  // On every launch: if push was on here and the phone still allows it, make
  // sure there is a subscription and the server has it. Subscribing with
  // permission already granted shows no prompt; telling the server again is
  // an upsert, and brings back one it dropped.
  async function keepPush(): Promise<void> {
    if (!supported() || Notification.permission !== 'granted') return
    // Turned on before this flag existed: a live subscription says so.
    if (!wanted() && (await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription())) want(true)
    if (!wanted()) return
    await subscribe().catch(() => {})
  }

  const testPush = () => apiJson<{ sent: number; failed: number }>('/api/push/test', { method: 'POST' })

  return { pushState, enablePush, disablePush, keepPush, testPush }
}
