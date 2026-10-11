import type { Env } from './env'
import { XError, type Subscription, type X } from './x'
import { getSetting, setSetting } from './store'

// The plumbing between X and this Worker: one webhook pointed at us, and one
// Activity subscription per kind of event. Repair is safe to run any number
// of times. It only creates what is missing.

// Likes are deliberately absent: nothing to do about a like, and each one costs.
export const EVENTS: Array<{ type: string; label: string; filter?: Record<string, string> }> = [
  { type: 'post.reply.create', label: 'Replies' },
  { type: 'post.mention.create', label: 'Mentions' },
  { type: 'post.quote.create', label: 'Quotes' },
  { type: 'post.repost.create', label: 'Reposts' },
  { type: 'follow.follow', label: 'Follows' },
]

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
      present: subs.some((s) => s.event_type === e.type),
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
    // Drop subscriptions of ours that the app no longer wants (likes, once).
    for (const s of subs) {
      if (EVENTS.some((e) => e.type === s.event_type) || (s.webhook_id && s.webhook_id !== webhookId)) continue
      try {
        await x.deleteSubscription(token, s.id)
      } catch {
        await x.deleteSubscription(env.X_BEARER_TOKEN, s.id).catch((e) => (errors['remove ' + s.event_type] = say(e)))
      }
    }
    for (const ev of EVENTS) {
      if (subs.some((s) => s.event_type === ev.type)) continue
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
