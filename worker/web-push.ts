// pwa-kit: push/functions/web-push.ts v1
// Web push without a library: RFC 8291 message encryption (aes128gcm, RFC
// 8188) and a VAPID token (RFC 8292), all on WebCrypto, so it runs in a
// Cloudflare Worker or Pages Function. The usual `web-push` package leans on
// Node's crypto and does not.
//
//   await fanOut(env.DB, { title, body, tag, url, unread }, env)
//
// env needs VAPID_PUBLIC_KEY (base64url, 65-byte uncompressed point),
// VAPID_PRIVATE_KEY (base64url d) and VAPID_SUBJECT (https URL or mailto:).
// Make them once with scripts/vapid.mjs and never change them: every
// existing subscription is bound to the public key.

type Bytes = Uint8Array<ArrayBuffer>

const b64uEncode = (bytes: Uint8Array | ArrayBuffer): string => {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ''
  for (const b of u) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const b64uDecode = (str: string): Bytes => {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}
const concat = (...parts: Uint8Array[]): Bytes => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}
const utf8 = (s: string): Bytes => new Uint8Array(new TextEncoder().encode(s))

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, bytes: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8))
}

export async function encryptPayload(plaintext: Bytes, p256dh: Bytes, auth: Bytes): Promise<Bytes> {
  const uaKey = await crypto.subtle.importKey('raw', p256dh, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const local = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
  const localPublic = new Uint8Array((await crypto.subtle.exportKey('raw', local.publicKey)) as ArrayBuffer)
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey } as any, local.privateKey, 256))
  const salt = crypto.getRandomValues(new Uint8Array(16))

  const ikm = await hkdf(auth, shared, concat(utf8('WebPush: info\0'), p256dh, localPublic), 32)
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12)

  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  // 0x02 marks the last (here, the only) record.
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(plaintext, new Uint8Array([2]))))

  const header = new Uint8Array(16 + 4 + 1 + localPublic.length)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, 4096)
  header[20] = localPublic.length
  header.set(localPublic, 21)
  return concat(header, sealed)
}

export async function vapidToken(audience: string, subject: string, publicKey: string, privateKey: string, now = Date.now()): Promise<string> {
  const pub = b64uDecode(publicKey)
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', d: privateKey, x: b64uEncode(pub.slice(1, 33)), y: b64uEncode(pub.slice(33, 65)), ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
  const head = b64uEncode(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = b64uEncode(utf8(JSON.stringify({ aud: audience, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })))
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(`${head}.${claims}`))
  return `${head}.${claims}.${b64uEncode(sig)}`
}

export interface PushSub { endpoint: string; p256dh: string; auth: string }
export interface Vapid { VAPID_PUBLIC_KEY: string; VAPID_PRIVATE_KEY: string; VAPID_SUBJECT: string }

export async function sendPush(sub: PushSub, payload: unknown, vapid: Vapid): Promise<number> {
  const body = await encryptPayload(utf8(JSON.stringify(payload)), b64uDecode(sub.p256dh), b64uDecode(sub.auth))
  const jwt = await vapidToken(new URL(sub.endpoint).origin, vapid.VAPID_SUBJECT, vapid.VAPID_PUBLIC_KEY, vapid.VAPID_PRIVATE_KEY)
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'high',
      Authorization: `vapid t=${jwt}, k=${vapid.VAPID_PUBLIC_KEY}`,
    },
    body,
  })
  return res.status
}

// Send to every device, and forget the ones the push service says are gone.
export async function fanOut(db: D1Database, payload: unknown, vapid: Vapid): Promise<{ sent: number; failed: number }> {
  const { results } = await db.prepare(`SELECT endpoint, p256dh, auth FROM push_subs`).all<PushSub>()
  let sent = 0, failed = 0
  await Promise.all(
    results.map(async (sub) => {
      try {
        const status = await sendPush(sub, payload, vapid)
        if (status === 404 || status === 410) await db.prepare(`DELETE FROM push_subs WHERE endpoint = ?1`).bind(sub.endpoint).run()
        if (status >= 200 && status < 300) sent++
        else failed++
      } catch {
        failed++
      }
    }),
  )
  return { sent, failed }
}
