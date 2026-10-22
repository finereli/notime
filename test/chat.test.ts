import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Chat, initSync } from '../node_modules/@xdevplatform/chat-xdk/pkg/chat_xdk_wasm.js'
import { convKey, fromEvent, juiceboxConfig, partnerOf, pinError, seal, signingEntry, unseal } from '../worker/chat'

const OWNER = '1000'
initSync({ module: readFileSync(new URL('../node_modules/@xdevplatform/chat-xdk/pkg/chat_xdk_wasm_bg.wasm', import.meta.url)) })

describe('x chat', () => {
  it('seals the keys so only the secret opens them', async () => {
    const keys = new Uint8Array(64).map((_, i) => i)
    const sealed = await seal('worker-secret', keys)
    expect(await unseal('worker-secret', sealed)).toEqual(keys)
    await expect(unseal('another-secret', sealed)).rejects.toThrow()
  })

  it('round-trips real chat keys through the seal', async () => {
    const a = new Chat()
    a.generateKeypairs()
    const exported = a.exportKeys()
    const b = new Chat()
    b.importKeys(await unseal('s', await seal('s', exported)), '1')
    expect(b.isUnlocked()).toBe(true)
    expect(b.getPublicKeys().identity).toEqual(a.getPublicKeys().identity)
  })

  it('finds the other person in a one-to-one, and nobody in a group or a note to self', () => {
    expect(partnerOf('1000:2001', OWNER)).toBe('2001')
    expect(partnerOf('2001-1000', OWNER)).toBe('2001')
    expect(partnerOf('1000-1000', OWNER)).toBe(null)
    expect(partnerOf('g123', OWNER)).toBe(null)
    expect(convKey('1000:2001')).toBe('1000-2001')
  })

  it('turns a decrypted text message into a dm', () => {
    const ev = { type: 'message', id: '77', senderId: '2001', createdAtMsec: 1_760_000_000_000, content: { contentType: 'text', text: 'hi there' } }
    expect(fromEvent(ev, undefined, '1000:2001', OWNER)).toEqual({
      kind: 'message',
      dm: { id: '77', conversation_id: '1000-2001', partner_id: '2001', sender_id: '2001', text: 'hi there', created_at: new Date(1_760_000_000_000).toISOString() },
    })
  })

  it('keeps edits and key changes, and drops what needs no answer', () => {
    const raw = { encoded: 'KEYCHANGE' }
    expect(fromEvent({ type: 'keyChange' }, raw, '1000-2001', OWNER)).toEqual({ kind: 'key', event: 'KEYCHANGE' })
    expect(fromEvent({ type: 'message', id: '9', senderId: '2001', content: { contentType: 'edit', targetMessageId: '77', newText: 'hello' } }, undefined, '1000-2001', OWNER)).toEqual({ kind: 'edit', target: '77', text: 'hello' })
    expect(fromEvent({ type: 'message', id: '9', senderId: '2001', content: { contentType: 'reaction', emoji: '👍' } }, undefined, '1000-2001', OWNER)).toBe(null)
    expect(fromEvent({ type: 'typing' }, undefined, '1000-2001', OWNER)).toBe(null)
    expect(fromEvent({ type: 'message', id: '9', senderId: '2001', content: { contentType: 'text', text: 'x' } }, undefined, 'g55', OWNER)).toBe(null)
  })

  it('says something for a photo with no words', () => {
    const d = fromEvent({ type: 'message', id: '9', senderId: '2001', attachments: [{ attachmentType: 'media' }], content: { contentType: 'text', text: '' } }, undefined, '1000-2001', OWNER)
    expect(d?.kind === 'message' && d.dm.text).toMatch(/Attachment/)
  })

  it('reads the juicebox config the way X sends it', () => {
    const embedded = JSON.stringify({ realms: [{ id: 'a', address: 'https://r/' }], register_threshold: 1, recover_threshold: 1 })
    expect(juiceboxConfig({ key_store_token_map_json: embedded, token_map: [] })).toBe(embedded)
    const derived = JSON.parse(juiceboxConfig({ token_map: [{ key: 'a', value: { address: 'https://a/' } }, { key: 'b', value: { address: 'https://b/' } }, { key: 'c', value: { address: 'https://c/' } }] }))
    expect(derived.recover_threshold).toBe(2)
    expect(derived.realms[1]).toEqual({ id: 'b', address: 'https://b/' })
  })

  it('explains a wrong PIN with the tries left', () => {
    expect(pinError({ reason: 0, guesses_remaining: 3 }).message).toBe('That PIN is wrong. 3 tries left before X locks the backup.')
    expect(pinError({ reason: 0, guesses_remaining: 0 }).message).toMatch(/no tries are left/)
    expect(pinError({ reason: 1 }).message).toMatch(/no key backup/)
    expect(pinError({ reason: 6 }).status).toBe(502)
  })

  it('maps a public key record to the signing entry the SDK wants', () => {
    expect(signingEntry('2001', { public_key_version: '5', public_key: 'ID', signing_public_key: 'SIG', identity_public_key_signature: 'BIND' })).toEqual({
      userId: '2001', publicKeyVersion: '5', publicKey: 'SIG', identityPublicKey: 'ID', identityPublicKeySignature: 'BIND',
    })
  })
})
