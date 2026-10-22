export interface Env {
  DB: D1Database
  ASSETS: Fetcher
  OWNER_USERNAME: string
  X_CLIENT_ID: string
  X_CLIENT_SECRET: string
  X_BEARER_TOKEN: string
  X_CONSUMER_SECRET?: string
  VAPID_PUBLIC_KEY: string
  VAPID_PRIVATE_KEY: string
  VAPID_SUBJECT: string
  // Seals the owner's X Chat keys at rest (worker/chat.ts).
  CHAT_SECRET?: string
  // Local development only. See worker/dev.ts for the two locks.
  DEV_AUTH?: string
  APP_ORIGIN?: string
}

export const json = (data: unknown, status = 200) => Response.json(data, { status })
export const fail = (error: string, status = 400) => Response.json({ error }, { status })
