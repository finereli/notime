<script lang="ts">
  import { apiJson } from '../lib/api'
  import { disablePush, enablePush, pushState, testPush, type PushState } from '../lib/push'
  import { toasts } from '$shared/lib/toast.svelte'

  let { pushAll = $bindable(false) }: { pushAll?: boolean } = $props()

  interface Status {
    url: string
    webhook: { id: string; valid: boolean } | null
    webhookError?: string
    subsError?: string
    events: Array<{ type: string; label: string; present: boolean; error?: string }>
    lastEventAt: string | null
  }
  interface Usage { month: string; total: number; rows: Array<{ kind: string; n: number }> }

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

  async function toggleAll() {
    const prev = pushAll
    pushAll = !pushAll
    try {
      await apiJson('/api/settings', { method: 'PUT', body: { pushAll } })
    } catch {
      pushAll = prev
      toasts.error('The change was not saved')
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
    owned_read: 'Mentions checked', media_metadata: 'Image descriptions', event_post: 'Replies, mentions, quotes, reposts',
    event_like: 'Likes', event_follow: 'Follows',
  }
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
        {push === 'on' ? 'This device gets a notification when someone replies to you, mentions you or quotes you.' : 'Get a notification here when someone replies to you, mentions you or quotes you.'}
      </p>
      <div class="row">
        <button class="btn" onclick={togglePush} disabled={pushBusy || push === 'denied'}>{push === 'on' ? 'Turn off on this device' : 'Turn on notifications'}</button>
        {#if push === 'on'}<button class="btn plain" onclick={sendTest} disabled={pushBusy}>Send a test</button>{/if}
      </div>
      {#if push === 'denied' && !pushNote}<p class="quiet">Notifications are blocked for this app in your device settings.</p>{/if}
    {/if}
    {#if pushNote}<p class="quiet" role="status">{pushNote}</p>{/if}

    <div class="row">
      <button class="btn plain" onclick={toggleAll}>{pushAll ? 'Stop notifying me about likes, reposts and follows' : 'Also notify me about likes, reposts and follows'}</button>
    </div>
    <p class="quiet">{pushAll ? 'Every like, repost and follow reaches your phone.' : 'Likes, reposts and follows stay in the list and never reach your phone.'}</p>
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
    <h2>What this has cost</h2>
    {#if usage}
      <p class="total">${usage.total.toFixed(2)} <span class="quiet">this month, roughly</span></p>
      {#if usage.rows.length}
        <ul class="checks">
          {#each usage.rows as r}<li><span>{KIND[r.kind] ?? r.kind}</span><span>{r.n}</span></li>{/each}
        </ul>
      {/if}
      <p class="quiet">An estimate from X's listed prices. A post costs about a cent and a half, a post with a link twenty cents. The X developer console has the real number.</p>
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
  .total { font-family: var(--font-write); font-size: 1.6rem; font-variant-numeric: tabular-nums; }
  .total .quiet { font-family: var(--font-body); }
</style>
