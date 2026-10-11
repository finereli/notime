// A running estimate of what the X API has cost. X bills per resource and
// dedupes within a UTC day, so this overcounts a little. It is meant to show
// the order of magnitude, not to reconcile an invoice.

export const PRICES: Record<string, number> = {
  post_create: 0.015,
  post_create_url: 0.2,
  post_read: 0.005,
  user_read: 0.01,
  owned_read: 0.001,
  media_metadata: 0.005,
  event_post: 0.005,
  event_like: 0.001,
  event_follow: 0.01,
}

export async function bump(db: D1Database, kind: string, n = 1): Promise<void> {
  if (n <= 0) return
  const day = new Date().toISOString().slice(0, 10)
  try {
    await db
      .prepare(`INSERT INTO usage (day, kind, n) VALUES (?1, ?2, ?3) ON CONFLICT(day, kind) DO UPDATE SET n = n + ?3`)
      .bind(day, kind, n)
      .run()
  } catch {}
}

export function cost(rows: Array<{ kind: string; n: number }>): number {
  return rows.reduce((sum, r) => sum + (PRICES[r.kind] ?? 0) * r.n, 0)
}

export async function monthToDate(db: D1Database) {
  const month = new Date().toISOString().slice(0, 7)
  const { results } = await db
    .prepare(`SELECT kind, SUM(n) AS n FROM usage WHERE day LIKE ?1 GROUP BY kind`)
    .bind(month + '-%')
    .all<{ kind: string; n: number }>()
  return { month, total: cost(results), rows: results }
}

// Good enough to tell a link from prose. X makes the real call when it bills.
const URL_RE = /(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|co|dev|app|ai|me|ly|gg|xyz|info|blog|tech|so|sh|to|fm|tv|us|uk|ca|de|fr|il)\b(?:\/\S*)?/i
export const hasUrl = (text: string) => URL_RE.test(text)
