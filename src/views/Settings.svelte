<script lang="ts">
  import { apiJson } from '../lib/api'
  import { disablePush, enablePush, pushState, testPush, type PushState } from '../lib/push'
  import { toasts } from '$shared/lib/toast.svelte'

  interface Status {
    url: string
    webhook: { id: string; valid: boolean } | null
    webhookError?: string
    subsError?: string
    events: Array<{ type: string; label: string; present: boolean; error?: string }>
    lastEventAt: string | null
  }
  interface Usage {
    month: string; total: number; rows: Array<{ kind: string; n: number }>
    credits: { total: number; free: number; prepaid: number; expires?: string } | null
    spent: number; since: string | null; spentMonth: number; low: number
  }

  let push = $state<PushState | null>(null)
  let pushBusy = $state(false)
  let pushNote = $state('')
  let status = $state<Status | null>(null)
  let statusFailed = $state(false)
  let repairing = $state(false)
  let usage = $state<Usage | null>(null)

  pushState().then((s) => (push = s))
  apiJson<Status>('/api/setup/status').then((s) => (status = s)).catch(() => (statusFailed = true))
  apiJson<Usage>('/api/usage').then((u) => (usage = u)).catch(() => {})

  // Agents (MCP clients) that can read notime.
  interface Agents { url: string; items: Array<{ id: string; name: string | null; created_at: string; last_used: string | null }> }
  let agents = $state<Agents | null>(null)
  let copied = $state(false)
  const loadAgents = () => apiJson<Agents>('/api/mcp/clients').then((a) => (agents = a)).catch(() => {})
  loadAgents()

  async function revokeAgent(id: string) {
    try {
      await apiJson('/api/mcp/revoke', { method: 'POST', body: { id } })
      await loadAgents()
    } catch {
      toasts.error('Could not take access back')
    }
  }

  async function copyUrl() {
    if (!agents) return
    try { await navigator.clipboard.writeText(agents.url); copied = true; setTimeout(() => (copied = false), 2000) } catch {}
  }

  // Status lines sit next to the button that caused them and clear themselves.
  function note(text: string, ms = 5000) {
    pushNote = text
    setTimeout(() => { if (pushNote === text) pushNote = '' }, ms)
  }

  async function togglePush() {
    pushBusy = true
    try {
      push = push === 'on' ? await disablePush() : await enablePush()
      if (push === 'denied') note('Notifications are blocked for this app in your device settings.')
    } catch (e) {
      note(e instanceof Error ? e.message : 'That did not work')
    } finally {
      pushBusy = false
    }
  }

  async function sendTest() {
    pushBusy = true
    try {
      const r = await testPush()
      note(r.sent ? `Sent to ${r.sent === 1 ? 'one device' : r.sent + ' devices'}.` : 'No device accepted it. Turn notifications on first.')
    } catch {
      note('The test could not be sent.')
    } finally {
      pushBusy = false
    }
  }


  async function repair() {
    repairing = true
    try {
      status = await apiJson<Status>('/api/setup/repair', { method: 'POST' })
    } catch {
      toasts.error('Repair failed')
    } finally {
      repairing = false
    }
  }

  const KIND: Record<string, string> = {
    post_create: 'Posts', post_create_url: 'Posts with a link', post_read: 'Posts looked up', user_read: 'People looked up',
    owned_read: 'Your posts and mentions read', media_metadata: 'Image descriptions', event_post: 'Replies, mentions, quotes delivered',
    event_like: 'Likes delivered', event_follow: 'Follows delivered', event_dm: 'Messages delivered', like: 'Likes', unlike: 'Unlikes',
    dm_read: 'Messages read from X', dm_send: 'Messages sent', like_read: 'Your likes read from X',
  }
  const money = (n: number) => '$' + n.toFixed(2)
  const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  const healthy = $derived(!!status?.webhook?.valid && status.events.every((e) => e.present))
  const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
</script>

<div class="page">
  <section>
    <h2>Notifications on this device</h2>
    {#if push === 'needs-install'}
      <p class="quiet">On an iPhone, notifications only work once the app is on your home screen. In Safari, tap Share, then "Add to Home Screen", open notime from there, and come back to this page.</p>
    {:else if push === 'unsupported'}
      <p class="quiet">This browser cannot receive push notifications.</p>
    {:else if push}
      <p class="quiet">
        {push === 'on' ? 'This device gets a notification when someone replies to you, mentions you, quotes you or sends you a message.' : 'Get a notification here when someone replies to you, mentions you, quotes you or sends you a message.'}
      </p>
      <div class="row">
        <button class="btn" onclick={togglePush} disabled={pushBusy || push === 'denied'}>{push === 'on' ? 'Turn off on this device' : 'Turn on notifications'}</button>
        {#if push === 'on'}<button class="btn plain" onclick={sendTest} disabled={pushBusy}>Send a test</button>{/if}
      </div>
      {#if push === 'denied' && !pushNote}<p class="quiet">Notifications are blocked for this app in your device settings.</p>{/if}
    {/if}
    {#if pushNote}<p class="quiet" role="status">{pushNote}</p>{/if}

  </section>

  <section>
    <h2>Connection to X</h2>
    {#if status}
      <p class="state" role="status"><span class="dot" class:ok={healthy}></span>{healthy ? 'X is delivering your notifications.' : 'Something is not connected.'}</p>
      <ul class="checks">
        <li class:bad={!status.webhook?.valid}>
          <span>Delivery address</span>
          <span>{status.webhook ? (status.webhook.valid ? 'Registered' : 'Not validated') : 'Missing'}</span>
        </li>
        {#if status.webhookError}<li class="why">{status.webhookError}</li>{/if}
        {#each status.events as e}
          <li class:bad={!e.present}><span>{e.label}</span><span>{e.present ? 'On' : 'Off'}</span></li>
          {#if !e.present && e.error}<li class="why">{e.error}</li>{/if}
        {/each}
        {#if status.subsError}<li class="why">{status.subsError}</li>{/if}
      </ul>
      <p class="quiet">{status.lastEventAt ? `Last heard from X on ${when(status.lastEventAt)}.` : 'Nothing has arrived from X yet.'}</p>
      <div class="row"><button class="btn plain" onclick={repair} disabled={repairing}>{repairing ? 'Repairing' : 'Repair connection'}</button></div>
    {:else if statusFailed}
      <p class="quiet">Could not check the connection.</p>
    {:else}
      <span class="spinner"></span>
    {/if}
  </section>

  <section>
    <h2>Agents</h2>
    <p class="quiet">An AI agent can read notime (notifications, conversations, posts, messages, cost) but never post or send. Give it this address; it will ask you to sign in with X to allow it.</p>
    {#if agents}
      <div class="row"><code class="url">{agents.url}</code><button class="btn plain" onclick={copyUrl}>{copied ? 'Copied' : 'Copy'}</button></div>
      {#if agents.items.length}
        <ul class="checks agents">
          {#each agents.items as a (a.id)}
            <li>
              <span>{a.name ?? 'An agent'}<span class="when">{a.last_used ? ` · used ${when(a.last_used + 'Z')}` : ' · not used yet'}</span></span>
              <button class="revoke" onclick={() => revokeAgent(a.id)}>Revoke</button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="quiet">No agent has access.</p>
      {/if}
    {/if}
  </section>

  <section>
    <h2>What this has cost</h2>
    {#if usage}
      {#if usage.since}
        <p class="total">{money(usage.spent)} <span class="quiet">spent since {date(usage.since)}</span></p>
        {#if usage.spentMonth !== usage.spent}<p class="quiet">{money(usage.spentMonth)} of it this month.</p>{/if}
      {/if}
      {#if usage.credits}
        <p class="balance" class:low={usage.credits.total < usage.low}>{money(usage.credits.total)} left on X</p>
        <p class="quiet">
          {#if usage.credits.free && usage.credits.expires}{money(usage.credits.free)} of it is free credit that expires on {date(usage.credits.expires)}.{/if}
          You get a notification if it drops below {money(usage.low)}.
        </p>
      {:else}
        <p class="quiet">X did not report the balance just now.</p>
      {/if}
      {#if usage.rows.length}
        <p class="quiet">Where it went this month, by count. X reports only the total, so the split is the app's own tally, about {money(usage.total)} at list prices.</p>
        <ul class="checks">
          {#each usage.rows as r}<li><span>{KIND[r.kind] ?? r.kind}</span><span>{r.n}</span></li>{/each}
        </ul>
      {/if}
    {:else}
      <span class="spinner"></span>
    {/if}
  </section>
</div>

<style>
  section { background: var(--bg-raised); border: 1px solid var(--border); border-radius: 16px; padding: 16px 18px; margin-bottom: 14px; display: flex; flex-direction: column; gap: 10px; }
  h2 { font-size: 0.875rem; font-weight: 500; color: var(--text-secondary); }
  .row { display: flex; gap: 8px; flex-wrap: wrap; }
  .btn { min-height: 44px; padding: 0 18px; border-radius: 22px; background: var(--accent); color: #fff; font-size: 0.9rem; font-weight: 500; text-align: start; }
  :global(.dark) .btn { color: #10201c; }
  .btn.plain, :global(.dark) .btn.plain { background: transparent; color: var(--accent); border: 1px solid var(--border); font-weight: 400; padding-block: 10px; line-height: 1.3; }
  .btn:disabled { opacity: 0.45; }

  .state { display: flex; align-items: center; gap: 8px; font-size: 0.95rem; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #f59e0b; flex: none; }
  .dot.ok { background: var(--ok); }
  .checks { list-style: none; font-size: 0.85rem; }
  .checks li { display: flex; justify-content: space-between; gap: 12px; padding: 5px 0; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
  .checks li span:first-child { color: var(--text-primary); }
  .checks li.bad span:last-child { color: var(--danger); }
  .checks li.why { color: var(--danger); font-size: 0.78rem; padding-top: 0; overflow-wrap: anywhere; }
  .url { flex: 1; min-width: 0; padding: 10px 12px; border-radius: 12px; background: var(--bg-hover); font-size: 0.8rem; overflow-wrap: anywhere; align-self: center; }
  .checks .when { color: var(--text-secondary); }
  .checks.agents li { align-items: center; }
  .revoke { color: var(--danger); font-size: 0.82rem; min-height: 32px; flex: none; }
  .total { font-family: var(--font-write); font-size: 1.6rem; font-variant-numeric: tabular-nums; }
  .total .quiet { font-family: var(--font-body); }
  .balance { font-size: 0.95rem; font-variant-numeric: tabular-nums; }
  .balance.low { color: var(--danger); }
</style>
