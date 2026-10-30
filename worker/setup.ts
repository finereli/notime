import type { Env } from './env'
import { XError, type Subscription, type X } from './x'
import { getSetting, logWebhook, setSetting } from './store'

// The plumbing between X and this Worker: one webhook pointed at us, and one
// Activity subscription per kind of event. Repair is safe to run any number
// of times. It only creates what is missing.

// What asks something of the owner, plus follows. Likes come one way only:
// the owner's own, which mark a reply as dealt with. Likes on the owner's
// posts are billed per like, so they are counted from the posts' numbers
// instead (see syncStats). Reposts are left out.
export const EVENTS: Array<{ type: string; label: string; filter?: Record<string, string> }> = [
  { type: 'post.reply.create', label: 'Replies' },
  { type: 'post.mention.create', label: 'Mentions' },
  { type: 'post.quote.create', label: 'Quotes' },
  { type: 'dm.received', label: 'Messages received' },
  { type: 'dm.sent', label: 'Messages you send elsewhere' },
  { type: 'chat.received', label: 'Encrypted messages received' },
  { type: 'chat.sent', label: 'Encrypted messages you send elsewhere' },
  { type: 'like.create', label: 'Your likes on X', filter: { direction: 'outbound' } },
  { type: 'follow.follow', label: 'Follows' },
]

// A subscription matches an event when the type and the direction agree. An
// old like subscription without a direction would deliver every like on
// every post, so it does not count.
const matches = (s: Subscription, e: (typeof EVENTS)[number]) =>
  s.event_type === e.type && ((s.filter as any)?.direction ?? null) === (e.filter?.direction ?? null)

// Changes whenever EVENTS does, so a deploy that changes it repairs itself.
export const SETUP_VERSION = JSON.stringify(EVENTS.map((e) => [e.type, e.filter]))

export const webhookUrl = (origin: string) => origin + '/api/webhook/x'

const say = (e: unknown) => (e instanceof XError ? `${e.status}: ${e.detail}` : String((e as Error)?.message ?? e))

async function listSubs(env: Env, x: X, token: string): Promise<{ subs: Subscription[]; error?: string }> {
  try {
    return { subs: await x.listSubscriptions(token) }
  } catch (first) {
    try {
      return { subs: await x.listSubscriptions(env.X_BEARER_TOKEN) }
    } catch {
      return { subs: [], error: say(first) }
    }
  }
}

export async function status(env: Env, x: X, token: string, origin: string) {
  const url = webhookUrl(origin)
  let webhook: { id: string; url: string; valid: boolean } | null = null
  let webhookError: string | undefined
  try {
    webhook = (await x.listWebhooks()).find((w) => w.url === url) ?? null
  } catch (e) {
    webhookError = say(e)
  }
  const { subs, error: subsError } = await listSubs(env, x, token)
  const errors: Record<string, string> = JSON.parse((await getSetting(env.DB, 'setup_errors')) || '{}')
  return {
    url,
    webhook,
    webhookError: webhookError ?? errors.webhook,
    subsError,
    events: EVENTS.map((e) => ({
      type: e.type,
      label: e.label,
      present: subs.some((s) => matches(s, e)),
      error: errors[e.type],
    })),
    lastEventAt: await getSetting(env.DB, 'last_event_at'),
  }
}

export async function repair(env: Env, x: X, token: string, origin: string, ownerId: string) {
  const url = webhookUrl(origin)
  const errors: Record<string, string> = {}
  let webhookId: string | undefined
  try {
    let hook = (await x.listWebhooks()).find((w) => w.url === url)
    if (!hook) hook = await x.createWebhook(url)
    else if (!hook.valid) await x.validateWebhook(hook.id)
    webhookId = hook.id
  } catch (e) {
    errors.webhook = say(e)
  }

  if (webhookId) {
    const { subs } = await listSubs(env, x, token)
    // Drop subscriptions of ours that the app no longer wants (likes, reposts, follows).
    for (const s of subs) {
      if (EVENTS.some((e) => matches(s, e)) || (s.webhook_id && s.webhook_id !== webhookId)) continue
      try {
        await x.deleteSubscription(token, s.id)
      } catch {
        await x.deleteSubscription(env.X_BEARER_TOKEN, s.id).catch((e) => (errors['remove ' + s.event_type] = say(e)))
      }
    }
    for (const ev of EVENTS) {
      if (subs.some((s) => matches(s, ev))) continue
      const body = { event_type: ev.type, filter: { user_id: ownerId, ...ev.filter }, tag: 'notime', webhook_id: webhookId }
      try {
        // Private events want the owner's token. The app token is the fallback
        // for the public ones.
        await x.createSubscription(token, body)
      } catch (first) {
        try {
          await x.createSubscription(env.X_BEARER_TOKEN, body)
        } catch {
          errors[ev.type] = say(first)
        }
      }
    }
  }
  await setSetting(env.DB, 'setup_errors', JSON.stringify(errors))
  return status(env, x, token, origin)
}

// X drops deliveries now and then. Replay asks it to resend everything it
// delivered or tried to in the last 24 hours (its limit); what arrives twice
// is ignored by event id, so the only cost is what X charges for the resend.
export async function replay(env: Env, x: X, origin: string | null, hours = 24): Promise<{ job: string; from: string; to: string }> {
  const hooks = await x.listWebhooks()
  // The scheduled run has no request to take the origin from; there is one
  // delivery address, and it is ours.
  const hook = origin ? hooks.find((w) => w.url === webhookUrl(origin)) : hooks.find((w) => w.url.endsWith('/api/webhook/x'))
  if (!hook) throw new XError(404, 'There is no delivery address to replay to. Repair the connection first.')
  const to = new Date(Date.now() - 60_000)
  const from = new Date(Math.max(to.getTime() - hours * 3600_000 + 5 * 60_000, hours < 24 ? Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()) : 0))
  const job = await x.replayWebhook(hook.id, from, to)
  await logWebhook(env.DB, 'replay', null, `job ${job}, ${from.toISOString()} to ${to.toISOString()}`)
  return { job, from: from.toISOString(), to: to.toISOString() }
}

// Every hour at :55, resend the last two hours, never reaching back past
// UTC midnight. X bills an event once per UTC day however often it is
// delivered, so this catches what X dropped at no extra cost; a gap is
// closed within the hour instead of waiting for the owner to notice.
export async function scheduledReplay(env: Env, x: X): Promise<void> {
  try {
    await replay(env, x, null, 2)
  } catch (e) {
    await logWebhook(env.DB, 'failed', 'replay', say(e))
  }
}

export async function deliveryLog(db: D1Database, limit = 30) {
  const { results } = await db.prepare(`SELECT at, kind, types, note FROM webhook_log ORDER BY id DESC LIMIT ?1`).bind(limit).all()
  return results
}
