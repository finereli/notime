import type { Env } from './env'
import type { Dm } from './events'
import { b64Encode, b64uDecode, utf8 } from './bytes'
import { getSetting, saveDm, setSetting } from './store'
import { bump } from './usage'
import { XError } from './x'

// X Chat: the encrypted messages, which is where X moved direct messages.
// X routes only ciphertext, so reading them takes the owner's private chat
// keys. The owner unlocks them once with their X Chat PIN; the server keeps
// them sealed with CHAT_SECRET (a Worker secret), so the database alone
// cannot open them. Decrypted messages land in the dms table like the old
// unencrypted ones, and the rest of the app does not know the difference.

// The two WASM pieces, injected so the tests can load them from disk.
export interface ChatRuntime {
  newChat(): any
  juicebox(): any
}
export type Call = (method: string, path: string, token: string, body?: Record<string, unknown>) => Promise<any>

export class ChatError extends Error {
  constructor(message: string, public status = 400) {
    super(message)
  }
}
// The other person has no chat keys, so the old unencrypted route is the
// only way to reach them.
export class NotOnChat extends Error {}

const KEY_FIELDS = 'public_key_version,public_key,signing_public_key,identity_public_key_signature'
const PUBLIC_KEYS_TTL = 6 * 3600_000

interface KeyRecord { public_key_version: string; public_key: string; signing_public_key: string; identity_public_key_signature: string; juicebox_config?: any }

// --- sealing the keys --------------------------------------------------------

async function aesKey(secret: string) {
  const raw = await crypto.subtle.digest('SHA-256', utf8(secret))
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function seal(secret: string, bytes: Uint8Array): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(secret), bytes as BufferSource))
  const out = new Uint8Array(12 + ct.length)
  out.set(iv)
  out.set(ct, 12)
  return b64Encode(out.buffer)
}

export async function unseal(secret: string, sealed: string): Promise<Uint8Array> {
  const all = b64uDecode(sealed)
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, await aesKey(secret), all.slice(12)))
}

// --- ids ---------------------------------------------------------------------

// Events say "a:b", listings say "a-b". One form everywhere.
export const convKey = (id: string) => String(id).replace(':', '-')

// The other person in a one-to-one, or null for a group or a note to self.
export function partnerOf(convId: string, ownerId: string): string | null {
  const ids = convKey(convId).split('-')
  if (ids.length !== 2 || !ids.every((i) => /^\d+$/.test(i))) return null
  const other = ids.filter((i) => i !== ownerId)
  return other.length === 1 ? other[0] : null
}

// --- unlocking ---------------------------------------------------------------

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

// The config X returns, in the shape the Juicebox client takes. The embedded
// JSON carries each realm's public key and the thresholds, so it wins.
export function juiceboxConfig(cfg: any): string {
  if (typeof cfg?.key_store_token_map_json === 'string') return cfg.key_store_token_map_json
  const realms = (cfg?.token_map ?? []).map((e: any) => ({ id: e.key, address: e.value?.address }))
  return JSON.stringify({ realms, register_threshold: realms.length, recover_threshold: Math.floor(realms.length / 2) + 1, pin_hashing_mode: 'Standard2019' })
}

const RECOVER_REASONS = ['InvalidPin', 'NotRegistered', 'InvalidAuth', 'UpgradeRequired', 'RateLimitExceeded', 'Assertion', 'Transient']

export function pinError(e: any): ChatError {
  const code = e?.reason ?? e?.reasonCode ?? e?.code
  const reason = typeof code === 'number' ? RECOVER_REASONS[code] : String(code ?? '')
  const left = e?.guesses_remaining ?? e?.guessesRemaining
  if (reason === 'InvalidPin') {
    if (left === 0) return new ChatError('That PIN was wrong and no tries are left. X has locked the backup; reset your chat PIN in the X app.')
    return new ChatError(`That PIN is wrong.${typeof left === 'number' ? ` ${left} ${left === 1 ? 'try' : 'tries'} left before X locks the backup.` : ''}`)
  }
  if (reason === 'NotRegistered') return new ChatError('X has no key backup for this account. Set up a chat PIN in the X app first.')
  if (reason === 'RateLimitExceeded') return new ChatError('Too many tries. Wait a few minutes and try again.')
  return new ChatError(`X's key backup did not answer (${reason || String(e?.message ?? e)}). Try again in a minute.`, 502)
}

export async function unlock(env: Env, rt: ChatRuntime, call: Call, token: string, ownerId: string, pin: string): Promise<void> {
  if (!env.CHAT_SECRET) throw new ChatError('The server is missing CHAT_SECRET.', 500)
  if (!pin.trim()) throw new ChatError('Enter your X Chat PIN')
  const r = await call('GET', `/2/users/${ownerId}/public_keys?public_key.fields=${KEY_FIELDS},juicebox_config`, token)
  const records: KeyRecord[] = r?.data ?? []
  const cfg = records.find((k) => k.juicebox_config)?.juicebox_config
  if (!cfg) throw new ChatError('X Chat is not set up on this account. Open Chat in the X app and set a PIN first.')

  const jb = rt.juicebox()
  const tokens = new Map<string, string>((cfg.token_map ?? []).map((e: any) => [String(e.key), String(e.value?.token ?? '')]))
  // Juicebox asks for each realm's token through this global.
  ;(globalThis as any).JuiceboxGetAuthToken = async (realm: string | Uint8Array) => tokens.get(typeof realm === 'string' ? realm : hex(realm)) ?? ''
  const client = new jb.Client(new jb.Configuration(juiceboxConfig(cfg)), [])
  let secret: Uint8Array
  try {
    secret = await client.recover(utf8(pin), new Uint8Array(0))
  } catch (e) {
    throw pinError(e)
  } finally {
    try { client.free?.() } catch {}
  }

  const sealed = await seal(env.CHAT_SECRET, secret)
  // Which registered key these are: the one whose public half matches.
  let version: string | null = null
  for (const rec of [...records].sort((a, b) => Number(b.public_key_version) - Number(a.public_key_version))) {
    const chat = rt.newChat()
    try {
      chat.importKeys(secret.slice(), rec.public_key_version)
      if (chat.matchesRegisteredKey(rec.public_key)) version = rec.public_key_version
    } finally {
      chat.free()
    }
    if (version) break
  }
  secret.fill(0)
  if (!version) throw new ChatError('The backed-up keys do not match the keys X has on record for this account.')
  await setSetting(env.DB, 'chat_keys', JSON.stringify({ version, sealed }))
  await savePublicKeys(env.DB, ownerId, records.map(({ juicebox_config, ...k }) => k))
}

export const isUnlocked = async (env: Env) => !!env.CHAT_SECRET && (await getSetting(env.DB, 'chat_keys')) !== null

export async function forget(env: Env): Promise<void> {
  await env.DB.prepare(`DELETE FROM settings WHERE key IN ('chat_keys', 'chat_synced', 'chat_filling')`).run()
}

// A chat engine holding the owner's keys, for one request. null when locked.
export async function openChat(env: Env, rt: ChatRuntime, ownerId: string): Promise<any | null> {
  const raw = await getSetting(env.DB, 'chat_keys')
  if (!raw || !env.CHAT_SECRET) return null
  const { version, sealed } = JSON.parse(raw) as { version: string; sealed: string }
  const chat = rt.newChat()
  chat.importKeys(await unseal(env.CHAT_SECRET, sealed), version)
  chat.setIdentity(ownerId, version)
  chat.setCacheKeys(true)
  return chat
}

// --- keys we keep ------------------------------------------------------------

async function savePublicKeys(db: D1Database, userId: string, records: KeyRecord[]) {
  await db
    .prepare(`INSERT INTO chat_public_keys (user_id, records, fetched_at) VALUES (?1, ?2, ?3) ON CONFLICT(user_id) DO UPDATE SET records = ?2, fetched_at = ?3`)
    .bind(userId, JSON.stringify(records), Date.now())
    .run()
}

async function publicKeys(env: Env, call: Call, token: string, userId: string, fresh = false): Promise<KeyRecord[]> {
  const row = await env.DB.prepare(`SELECT records, fetched_at FROM chat_public_keys WHERE user_id = ?1`).bind(userId).first<{ records: string; fetched_at: number }>()
  if (row && !(fresh && Date.now() - row.fetched_at > 60_000) && Date.now() - row.fetched_at < PUBLIC_KEYS_TTL) return JSON.parse(row.records)
  const r = await call('GET', `/2/users/${userId}/public_keys?public_key.fields=${KEY_FIELDS}`, token)
  const records: KeyRecord[] = (r?.data ?? []).map(({ juicebox_config, ...k }: KeyRecord) => k)
  await savePublicKeys(env.DB, userId, records)
  return records
}

export const signingEntry = (userId: string, r: KeyRecord) => ({
  userId,
  publicKeyVersion: String(r.public_key_version),
  publicKey: r.signing_public_key,
  identityPublicKey: r.public_key,
  identityPublicKeySignature: r.identity_public_key_signature,
})

async function signingKeys(env: Env, call: Call, token: string, ids: string[], fresh = false) {
  const out = []
  for (const id of ids) for (const r of await publicKeys(env, call, token, id, fresh)) out.push(signingEntry(id, r))
  return out
}

async function saveKeyEvents(db: D1Database, convId: string, events: string[]) {
  if (!events.length) return
  await db.batch(events.map((e) => db.prepare(`INSERT OR IGNORE INTO chat_key_events (conversation_id, event) VALUES (?1, ?2)`).bind(convKey(convId), e)))
}

async function keyEvents(db: D1Database, convId: string): Promise<string[]> {
  const { results } = await db.prepare(`SELECT event FROM chat_key_events WHERE conversation_id = ?1`).bind(convKey(convId)).all<{ event: string }>()
  return results.map((r) => r.event)
}

// --- decrypting --------------------------------------------------------------

interface Raw { encoded: string; id?: string; created_at?: string }
type Decrypted = { kind: 'message'; dm: Dm } | { kind: 'edit'; target: string; text: string } | { kind: 'key'; event: string }

const iso = (ms: unknown, fallback?: string) => {
  const n = Number(ms)
  return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : fallback ? new Date(fallback).toISOString() : new Date().toISOString()
}

// One decrypted event in the app's terms. Reactions, typing and receipts
// are not actionable, so they are left out.
export function fromEvent(ev: any, raw: Raw | undefined, convId: string, ownerId: string): Decrypted | null {
  if (!ev) return null
  if (ev.type === 'keyChange' && raw) return { kind: 'key', event: raw.encoded }
  if (ev.type !== 'message') return null
  const partner = partnerOf(convId, ownerId)
  if (!partner) return null
  const c = ev.content ?? {}
  if (c.contentType === 'edit' && c.targetMessageId && typeof c.newText === 'string') return { kind: 'edit', target: String(c.targetMessageId), text: c.newText }
  if (c.contentType && c.contentType !== 'text') return null
  const attached = (ev.attachments?.length ?? 0) + (c.attachments?.length ?? 0) > 0
  const text = typeof c.text === 'string' && c.text ? c.text : attached ? '[Attachment: open X to see it]' : ''
  if (!text) return null
  const id = String(ev.id ?? raw?.id ?? ev.messageId ?? ev.sequenceId ?? '')
  if (!id) return null
  const sender = String(ev.senderId ?? '')
  if (!sender) return null
  return { kind: 'message', dm: { id, conversation_id: convKey(convId), partner_id: partner, sender_id: sender, text, created_at: iso(ev.createdAtMsec, raw?.created_at) } }
}

// Decrypt a batch, retrying once with fresh public keys when a signature
// does not check out (someone set up a new device).
async function decrypt(env: Env, chat: any, call: Call, token: string, convId: string, ownerId: string, raws: Raw[]): Promise<Decrypted[]> {
  const keys = await keyEvents(env.DB, convId)
  const partner = partnerOf(convId, ownerId)
  const people = partner ? [ownerId, partner] : [ownerId]
  const run = async (fresh: boolean) => chat.decryptEvents([...keys, ...raws.map((r) => r.encoded)], await signingKeys(env, call, token, people, fresh))
  let res = await run(false)
  if (Object.keys(res?.errors ?? {}).length) {
    const again = await run(true)
    if (Object.keys(again?.errors ?? {}).length < Object.keys(res.errors).length) res = again
    for (const [i, err] of Object.entries(res?.errors ?? {})) if (Number(i) >= keys.length) console.error('chat decrypt failed', convId, err)
  }
  const byB64 = new Map(raws.map((r) => [r.encoded, r]))
  const out: Decrypted[] = []
  for (const m of res?.messages ?? []) {
    const d = fromEvent(m.event, m.originalB64 ? byB64.get(m.originalB64) : undefined, convId, ownerId)
    if (d) out.push(d)
  }
  return out
}

// Store what came out, oldest first, so a reply marks what it answers as
// read (see saveDm). Returns the messages that are new.
async function store(env: Env, convId: string, ownerId: string, items: Decrypted[]): Promise<Dm[]> {
  await saveKeyEvents(env.DB, convId, items.flatMap((d) => (d.kind === 'key' ? [d.event] : [])))
  const fresh: Dm[] = []
  const dms = items.flatMap((d) => (d.kind === 'message' ? [d.dm] : [])).sort((a, b) => a.created_at.localeCompare(b.created_at))
  for (const m of dms) if (await saveDm(env.DB, m, ownerId)) fresh.push(m)
  for (const d of items) if (d.kind === 'edit') await env.DB.prepare(`UPDATE dms SET text = ?2 WHERE id = ?1`).bind(d.target, d.text).run()
  return fresh
}

// --- reading from X ----------------------------------------------------------

// The latest events of one conversation. A cent each, like the old messages.
export async function syncConversation(env: Env, chat: any, call: Call, token: string, ownerId: string, convId: string, max = 20): Promise<Dm[]> {
  const r = await call('GET', `/2/chat/conversations/${convKey(convId)}/events?max_results=${max}`, token)
  const data: any[] = r?.data ?? []
  await bump(env.DB, 'dm_read', data.length)
  await saveKeyEvents(env.DB, convId, (r?.meta?.conversation_key_events ?? []).filter((e: unknown) => typeof e === 'string'))
  const raws = data.filter((e) => typeof e.encoded_event === 'string').map((e) => ({ encoded: e.encoded_event, id: e.id ? String(e.id) : undefined, created_at: e.created_at }))
  return store(env, convId, ownerId, await decrypt(env, chat, call, token, convId, ownerId, raws))
}

// The conversation id X uses with this person, if we have seen one.
async function knownConversation(db: D1Database, ownerId: string, partnerId: string): Promise<string | null> {
  const row = await db
    .prepare(`SELECT conversation_id FROM chat_key_events WHERE conversation_id IN (?1, ?2) LIMIT 1`)
    .bind(`${ownerId}-${partnerId}`, `${partnerId}-${ownerId}`)
    .first<{ conversation_id: string }>()
  return row?.conversation_id ?? null
}

export async function syncPartner(env: Env, chat: any, call: Call, token: string, ownerId: string, partnerId: string): Promise<number> {
  const conv = (await knownConversation(env.DB, ownerId, partnerId)) ?? `${ownerId}-${partnerId}`
  return (await syncConversation(env, chat, call, token, ownerId, conv)).length
}

// The first fill: the most recent conversations, a few messages each.
// Returns the people in them.
export async function syncInbox(env: Env, chat: any, call: Call, token: string, ownerId: string, conversations = 12, perConversation = 10): Promise<string[]> {
  const r = await call('GET', `/2/chat/conversations?max_results=${conversations}`, token)
  const partners: string[] = []
  for (const c of r?.data ?? []) {
    if (c.type && c.type !== 'direct') continue
    const partner = partnerOf(String(c.id), ownerId)
    if (!partner) continue
    try {
      await syncConversation(env, chat, call, token, ownerId, String(c.id), perConversation)
      partners.push(partner)
    } catch (e) {
      console.error('chat sync failed', c.id, e)
    }
  }
  await setSetting(env.DB, 'chat_synced', new Date().toISOString())
  return partners
}

// One webhook delivery. Returns the message when it is new and from someone
// else, so the caller can push it.
export async function ingestChat(env: Env, rt: ChatRuntime, call: Call, getToken: () => Promise<string>, event: any, ownerId: string): Promise<Dm | null> {
  const db = env.DB
  const uuid = event?.event_uuid ? String(event.event_uuid) : null
  if (uuid) {
    const fresh = await db.prepare(`INSERT OR IGNORE INTO events_seen (uuid) VALUES (?1)`).bind(uuid).run()
    if (!fresh.meta.changes) return null
  }
  if (event?.event_type === 'chat.received') await bump(db, 'event_dm')
  await setSetting(db, 'last_event_at', new Date().toISOString())
  const p = event?.payload ?? {}
  if (!p.conversation_id || typeof p.encoded_event !== 'string') return null
  const convId = convKey(String(p.conversation_id))
  if (typeof p.conversation_key_change_event === 'string') await saveKeyEvents(db, convId, [p.conversation_key_change_event])
  const chat = await openChat(env, rt, ownerId)
  if (!chat) return null
  try {
    const items = await decrypt(env, chat, call, await getToken(), convId, ownerId, [{ encoded: p.encoded_event }])
    const fresh = await store(env, convId, ownerId, items)
    return fresh.find((m) => m.sender_id !== ownerId) ?? null
  } finally {
    chat.free()
  }
}

// --- sending -----------------------------------------------------------------

const newest = (records: KeyRecord[]) => [...records].sort((a, b) => Number(b.public_key_version) - Number(a.public_key_version))[0]

export async function sendChat(env: Env, chat: any, call: Call, token: string, ownerId: string, partnerId: string, text: string): Promise<Dm> {
  let conv = await knownConversation(env.DB, ownerId, partnerId)
  // Never seen this conversation's keys: X may still have them.
  if (!conv) {
    await syncConversation(env, chat, call, token, ownerId, `${ownerId}-${partnerId}`, 5).catch((e) => {
      if (!(e instanceof XError && (e.status === 404 || e.status === 400))) throw e
    })
    conv = await knownConversation(env.DB, ownerId, partnerId)
  }
  let key: { conversationKey: Uint8Array; conversationKeyVersion: string } | null = null
  const signing = await signingKeys(env, call, token, [ownerId, partnerId])
  if (conv) {
    // Puts the conversation key in the engine's cache.
    chat.decryptEvents(await keyEvents(env.DB, conv), signing)
  } else {
    // A first message: make the conversation key and give each side a copy.
    const theirs = await publicKeys(env, call, token, partnerId, true)
    if (!theirs.length) throw new NotOnChat()
    const them = newest(theirs)
    if (!chat.verifyKeyBinding(them.public_key, them.signing_public_key, them.identity_public_key_signature)) throw new ChatError("X sent keys for this person that do not check out, so the message was not sent.", 502)
    const me = newest(await publicKeys(env, call, token, ownerId))
    const prepared = chat.prepareConversationKeyChange({
      publicKeys: [
        { userId: ownerId, publicKey: me.public_key, keyVersion: String(me.public_key_version) },
        { userId: partnerId, publicKey: them.public_key, keyVersion: String(them.public_key_version) },
      ],
    })
    const r = await call('POST', `/2/chat/conversations/${partnerId}/keys`, token, {
      conversation_key_version: prepared.conversationKeyVersion,
      conversation_participant_keys: prepared.participantKeys.map((pk: any) => ({ user_id: pk.userId, encrypted_conversation_key: pk.encryptedKey, public_key_version: pk.publicKeyVersion })),
      action_signatures: prepared.actionSignatures.map((s: any) => ({
        message_id: s.messageId,
        encoded_message_event_detail: s.encodedMessageEventDetail,
        message_event_signature: { signature: s.signature, public_key_version: s.publicKeyVersion, signature_version: s.signatureVersion },
      })),
    })
    conv = convKey(r?.data?.conversation_id ?? prepared.conversationId)
    key = { conversationKey: prepared.conversationKey, conversationKeyVersion: prepared.conversationKeyVersion }
  }
  const payload = chat.encryptMessage({ conversationId: conv, text, ...(key ?? {}) })
  const r = await call('POST', `/2/chat/conversations/${partnerId}/messages`, token, {
    message_id: payload.messageId,
    encoded_message_create_event: payload.encryptedContent,
    encoded_message_event_signature: payload.encodedEventSignature,
  })
  await bump(env.DB, 'dm_send')
  // X answers with the stored event; its id is the one the chat.sent
  // delivery will carry, so the message is kept once.
  let id = String(payload.messageId)
  const echo = r?.data?.encoded_message_event
  if (typeof echo === 'string') {
    try {
      const ev = chat.decryptEvent(echo, key ? { [key.conversationKeyVersion]: key.conversationKey } : undefined, signing)
      if (ev?.id) id = String(ev.id)
    } catch {}
  }
  const m: Dm = { id, conversation_id: conv, partner_id: partnerId, sender_id: ownerId, text, created_at: new Date().toISOString() }
  await saveDm(env.DB, m, ownerId)
  return m
}
