// Shared by the scripts here: read .env without ever printing what is in it.
import { readFileSync } from 'node:fs'

export function readEnv(path = '.env') {
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return out
}

// What the Worker needs, by the names it uses. X's console calls the OAuth 1
// secret "Secret Key"; the Worker calls it what it is.
export function workerSecrets(env) {
  const need = {
    X_CLIENT_ID: env.X_CLIENT_ID,
    X_CLIENT_SECRET: env.X_CLIENT_SECRET,
    X_BEARER_TOKEN: env.X_BEARER_TOKEN,
    X_CONSUMER_SECRET: env.X_SECRET_KEY,
    VAPID_PUBLIC_KEY: env.VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: env.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: env.VAPID_SUBJECT,
  }
  const missing = Object.entries(need).filter(([, v]) => !v).map(([k]) => k)
  if (missing.length) throw new Error('Missing in .env: ' + missing.join(', ') + '. Run `node scripts/vapid.mjs` for the VAPID ones.')
  return need
}
