import { createHmac, webcrypto } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { crcResponse, verifySignature } from '../worker/webhook'
import { encryptPayload, vapidToken } from '../worker/push'
import { b64uDecode, b64uEncode, concat, utf8, type Bytes } from '../worker/bytes'
import { mentionNotification, parseEvent, pushText } from '../worker/events'
import { NeedsLogin, RefreshRejected, freshToken, type TokenRow, type TokenSet, type TokenStore } from '../worker/oauth'
import { cost, hasUrl } from '../worker/usage'

const subtle = webcrypto.subtle as unknown as SubtleCrypto
const OWNER = '1000'

describe('webhook', () => {
  it('answers the CRC challenge with the HMAC X expects', async () => {
    const expected = 'sha256=' + createHmac('sha256', 'client-secret').update('challenge_string').digest('base64')
    expect(await crcResponse('client-secret', 'challenge_string')).toEqual({ response_token: expected })
  })

  it('accepts a body signed with the client secret and rejects a tampered one', async () => {
    const body = utf8('{"data":{"event_type":"follow.follow"}}')
    const sig = 'sha256=' + createHmac('sha256', 'client-secret').update(body).digest('base64')
    const ok = new Headers({ 'X-Twitter-Webhooks-Signature-OAuth2': sig })
    expect(await verifySignature(body, ok, 'client-secret')).toBe(true)
    expect(await verifySignature(utf8('{"data":{}}'), ok, 'client-secret')).toBe(false)
    expect(await verifySignature(body, ok, 'other-secret')).toBe(false)
    expect(await verifySignature(body, new Headers(), 'client-secret')).toBe(false)
  })

  it('falls back to the legacy header and the consumer secret', async () => {
    const body = utf8('{}')
    const sig = 'sha256=' + createHmac('sha256', 'consumer').update(body).digest('base64')
    const h = new Headers({ 'X-Twitter-Webhooks-Signature': sig })
    expect(await verifySignature(body, h, 'client-secret', 'consumer')).toBe(true)
    expect(await verifySignature(body, h, 'client-secret')).toBe(false)
  })
})

describe('web push', () => {
  it('encrypts a payload the browser side can decrypt (RFC 8291)', async () => {
    // Play the browser: make its key pair and auth secret, then decrypt.
    const ua = (await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
    const uaPublic = new Uint8Array(await subtle.exportKey('raw', ua.publicKey))
    const auth = webcrypto.getRandomValues(new Uint8Array(16))
    const message = JSON.stringify({ title: 'Ana replied', body: 'Did you consider the offline case?' })

    const body = await encryptPayload(utf8(message), uaPublic, auth)

    const salt = body.slice(0, 16)
    expect(new DataView(body.buffer).getUint32(16)).toBe(4096)
    const idLen = body[20]
    expect(idLen).toBe(65)
    const serverPublic = body.slice(21, 21 + idLen)
    const sealed = body.slice(21 + idLen)

    const serverKey = await subtle.importKey('raw', serverPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
    const shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: serverKey }, ua.privateKey, 256))
    const hkdf = async (s: Bytes, ikm: Bytes, info: Bytes, n: number) =>
      new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: s, info }, await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), n * 8))
    const ikm = await hkdf(auth, shared, concat(utf8('WebPush: info\0'), uaPublic, serverPublic), 32)
    const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16)
    const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12)
    const plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, await subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), sealed))

    expect(plain[plain.length - 1]).toBe(2)
    expect(new TextDecoder().decode(plain.slice(0, -1))).toBe(message)
  })

  it('signs a VAPID token the public key verifies', async () => {
    const pair = (await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
    const pub = b64uEncode(new Uint8Array(await subtle.exportKey('raw', pair.publicKey)))
    const priv = (await subtle.exportKey('jwk', pair.privateKey)).d!
    const jwt = await vapidToken('https://push.example', 'mailto:a@b.c', pub, priv, 1_700_000_000_000)
    const [head, claims, sig] = jwt.split('.')
    expect(JSON.parse(new TextDecoder().decode(b64uDecode(claims)))).toEqual({ aud: 'https://push.example', exp: 1_700_000_000 + 43200, sub: 'mailto:a@b.c' })
    expect(await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, b64uDecode(sig), utf8(`${head}.${claims}`))).toBe(true)
  })
})

describe('events', () => {
  const author = { id: '2001', username: 'ana', name: 'Ana Lima', profile_image_url: 'https://img/ana.jpg' }
  const env = (event_type: string, payload: unknown, includes: unknown = {}) => ({ event_uuid: 'u1', created_at: '2026-10-11T10:00:00.000Z', filter: { user_id: OWNER }, event_type, payload, includes })

  it('reads a mention, with its author from includes', () => {
    const p = parseEvent(env('post.mention.create', { id: '50', text: 'hey @owner', author_id: '2001', created_at: '2026-10-11T09:00:00.000Z' }, { users: [author, { id: OWNER, username: 'owner', name: 'Owner' }] }), OWNER)
    expect(p.notification).toMatchObject({ id: 'post:50', type: 'mention', actor_id: '2001', post_id: '50', target_post_id: null, text: 'hey @owner', created_at: '2026-10-11T09:00:00.000Z' })
    expect(p.users.map((u) => u.id)).toEqual(['2001', OWNER])
    expect(p.billed).toBe('event_post')
  })

  it('reads a reply and finds the post it answers, with empty includes', () => {
    const p = parseEvent(env('post.reply.create', { id: '51', text: 'agreed', author_id: '2001', in_reply_to_tweet_id: '40', referenced_tweets: [{ type: 'replied_to', id: '40' }] }), OWNER)
    expect(p.notification).toMatchObject({ id: 'post:51', type: 'reply', target_post_id: '40' })
    expect(p.users).toEqual([])
  })

  it('gives a reply and a mention of the same post the same id', () => {
    const post = { id: '52', text: '@owner yes', author_id: '2001', referenced_tweets: [{ type: 'replied_to', id: '40' }] }
    expect(parseEvent(env('post.reply.create', post), OWNER).notification!.id).toBe(parseEvent(env('post.mention.create', post), OWNER).notification!.id)
  })

  it('reads a quote and a repost', () => {
    expect(parseEvent(env('post.quote.create', { id: '53', text: 'this', author_id: '2001', referenced_tweets: [{ type: 'quoted', id: '40' }] }), OWNER).notification).toMatchObject({ id: 'post:53', type: 'quote', target_post_id: '40' })
    expect(parseEvent(env('post.repost.create', { id: '54', text: 'RT @owner: hi', author_id: '2001', referenced_tweets: [{ type: 'retweeted', id: '40' }] }), OWNER).notification).toMatchObject({ id: 'repost:54', type: 'repost', target_post_id: '40' })
  })

  it('drops likes: nothing to do about a like', () => {
    const like = { id: 'l1', created_at: '2026-10-11T09:30:00.000Z', liking_user_id: '2001', liked_tweet_id: '40', liked_tweet_author_id: OWNER }
    const p = parseEvent(env('like.create', like, { users: [author], tweets: [{ id: '40', text: 'my post', author_id: OWNER }] }), OWNER)
    expect(p.notification).toBeNull()
    expect(p.billed).toBe('event_like')
  })

  it('reads a follow from payload.source', () => {
    const p = parseEvent(env('follow.follow', { source: { data: author }, target: { data: { id: OWNER, username: 'owner' } } }), OWNER)
    expect(p.notification).toMatchObject({ id: 'follow:2001', type: 'follow', actor_id: '2001' })
    expect(p.users[0]).toMatchObject({ id: '2001', username: 'ana' })
  })

  it('ignores the owner replying to themselves', () => {
    expect(parseEvent(env('post.reply.create', { id: '55', text: 'more', author_id: OWNER }), OWNER).notification).toBeNull()
  })

  it('survives payloads that are missing, wrong or unknown', () => {
    for (const ev of [null, undefined, {}, { event_type: 'post.reply.create' }, { event_type: 'like.create', payload: null }, { event_type: 'follow.follow', payload: { source: 7 } }, { event_type: 'news.new', payload: { x: 1 } }, { event_type: 'post.mention.create', payload: { id: '1' }, includes: { users: 'nope', tweets: [null, 3] } }]) {
      expect(() => parseEvent(ev, OWNER)).not.toThrow()
      expect(parseEvent(ev, OWNER).notification).toBeNull()
    }
  })

  it('classifies backfilled mentions as replies only when they answer the owner', () => {
    expect(mentionNotification({ id: '60', text: 'x', author_id: '2001', in_reply_to_user_id: OWNER, referenced_tweets: [{ type: 'replied_to', id: '40' }] }, OWNER)).toMatchObject({ id: 'post:60', type: 'reply', target_post_id: '40' })
    expect(mentionNotification({ id: '61', text: 'x', author_id: '2001', in_reply_to_user_id: '3003', referenced_tweets: [{ type: 'replied_to', id: '41' }] }, OWNER)).toMatchObject({ type: 'mention', target_post_id: null })
    expect(mentionNotification({ id: '62', text: 'x', author_id: '2001' }, OWNER)).toMatchObject({ type: 'mention' })
  })

  it('writes push text that says who did what', () => {
    expect(pushText('reply', 'Ana Lima', 'agreed', 'my post')).toEqual({ title: 'Ana Lima replied', body: 'agreed' })
    expect(pushText('repost', 'Ana Lima', 'RT @owner: my post', 'my post')).toEqual({ title: 'Ana Lima reposted you', body: 'my post' })
    expect(pushText('follow', 'Ana Lima', null, null)).toEqual({ title: 'Ana Lima followed you', body: '' })
  })
})

describe('token refresh', () => {
  const HOUR = 3600_000
  function memory(row: TokenRow): TokenStore & { row: TokenRow } {
    return {
      row,
      async load() { return { ...this.row } },
      async save(prev, next, now) { if (this.row.refresh_token === prev) this.row = { access_token: next.access_token, refresh_token: next.refresh_token, expires_at: now + next.expires_in * 1000, needs_login: 0 } },
      async markNeedsLogin(prev) { if (this.row.refresh_token === prev) this.row.needs_login = 1 },
    }
  }
  const noPause = async () => {}

  it('returns the stored token while it is fresh, without calling X', async () => {
    const store = memory({ access_token: 'a1', refresh_token: 'r1', expires_at: 10 * HOUR, needs_login: 0 })
    let calls = 0
    expect(await freshToken(store, async () => { calls++; throw new Error('no') }, () => 0, noPause)).toBe('a1')
    expect(calls).toBe(0)
  })

  it('refreshes a stale token and stores the new pair', async () => {
    const store = memory({ access_token: 'a1', refresh_token: 'r1', expires_at: 0, needs_login: 0 })
    expect(await freshToken(store, async (rt) => ({ access_token: 'a2', refresh_token: rt + '+', expires_in: 7200 }), () => 1000, noPause)).toBe('a2')
    expect(store.row).toMatchObject({ access_token: 'a2', refresh_token: 'r1+', expires_at: 1000 + 7200_000 })
  })

  it('lets two requests race for one single-use refresh token and both come out with a working token', async () => {
    const store = memory({ access_token: 'a1', refresh_token: 'r1', expires_at: 0, needs_login: 0 })
    const spent = new Set<string>()
    // X honours a refresh token once, then refuses it.
    const refresh = async (rt: string): Promise<TokenSet> => {
      await new Promise((r) => setTimeout(r, 5))
      if (spent.has(rt)) throw new RefreshRejected('token was already used')
      spent.add(rt)
      return { access_token: 'a2', refresh_token: 'r2', expires_in: 7200 }
    }
    const [one, two] = await Promise.all([freshToken(store, refresh, () => 1000, noPause), freshToken(store, refresh, () => 1000, noPause)])
    expect([one, two]).toEqual(['a2', 'a2'])
    expect(store.row.needs_login).toBe(0)
  })

  it('asks for a new login only when the grant is truly dead', async () => {
    const store = memory({ access_token: 'a1', refresh_token: 'r1', expires_at: 0, needs_login: 0 })
    await expect(freshToken(store, async () => { throw new RefreshRejected('revoked') }, () => 1000, noPause)).rejects.toBeInstanceOf(NeedsLogin)
    expect(store.row.needs_login).toBe(1)
    await expect(freshToken(store, async () => ({ access_token: 'x', refresh_token: 'y', expires_in: 1 }), () => 1000, noPause)).rejects.toBeInstanceOf(NeedsLogin)
  })

  it('does not log the owner out over a network failure', async () => {
    const store = memory({ access_token: 'a1', refresh_token: 'r1', expires_at: 0, needs_login: 0 })
    await expect(freshToken(store, async () => { throw new Error('timeout') }, () => 1000, noPause)).rejects.toThrow('timeout')
    expect(store.row.needs_login).toBe(0)
  })
})

describe('usage', () => {
  it('knows a link when it sees one', () => {
    for (const t of ['see https://example.com/a', 'www.example.org', 'read finereli.com today', 'go to scribe.finereli.com/download']) expect(hasUrl(t)).toBe(true)
    for (const t of ['no links here.', 'version 1.2 is out', 'e.g. this', 'end.Start']) expect(hasUrl(t)).toBe(false)
  })
  it('prices a month', () => {
    expect(cost([{ kind: 'post_create', n: 10 }, { kind: 'post_create_url', n: 1 }, { kind: 'owned_read', n: 100 }])).toBeCloseTo(0.45)
  })
})
