// Make the VAPID key pair that signs our push messages, once, and append it
// to .env. Changing these keys later silently breaks every existing push
// subscription, so the script refuses to overwrite.
import { appendFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import { readEnv } from './env.mjs'

if (readEnv().VAPID_PRIVATE_KEY) {
  console.log('VAPID keys already in .env. Leaving them alone.')
  process.exit(0)
}
const b64u = (buf) => Buffer.from(buf).toString('base64url')
const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const pub = b64u(await webcrypto.subtle.exportKey('raw', pair.publicKey))
const priv = (await webcrypto.subtle.exportKey('jwk', pair.privateKey)).d
appendFileSync('.env', `\nVAPID_PUBLIC_KEY=${pub}\nVAPID_PRIVATE_KEY=${priv}\nVAPID_SUBJECT=https://notime.finereli.com\n`)
console.log('Wrote VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT to .env')
