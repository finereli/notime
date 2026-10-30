<script lang="ts">
  import { settings as s, when } from '../../lib/settings.svelte'
  s.loadLog()

  const KIND: Record<string, string> = { delivery: 'Delivered', bad_signature: 'Rejected: bad signature', crc: 'X checked the address', failed: 'Failed', missed: 'Missed, found later', replay: 'Replay asked' }
  const TYPE: Record<string, string> = {
    'post.reply.create': 'reply', 'post.mention.create': 'mention', 'post.quote.create': 'quote', 'dm.received': 'message', 'dm.sent': 'message sent',
    'chat.received': 'message', 'chat.sent': 'message sent', 'like.create': 'your like', 'follow.follow': 'follow', chat: 'message', decrypt: 'decrypting',
  }
  const what = (types: string | null) => (types ?? '').split(' ').filter(Boolean).map((t) => TYPE[t] ?? t).join(', ')
</script>

{#if s.status}
  <p class="state" role="status"><span class="dot" class:ok={s.healthy}></span>{s.healthy ? 'X is delivering your notifications.' : 'Something is not connected.'}</p>
  <ul class="checks">
    <li class:bad={!s.status.webhook?.valid}>
      <span>Delivery address</span>
      <span>{s.status.webhook ? (s.status.webhook.valid ? 'Registered' : 'Not validated') : 'Missing'}</span>
    </li>
    {#if s.status.webhookError}<li class="why">{s.status.webhookError}</li>{/if}
    {#each s.status.events as e}
      <li class:bad={!e.present}><span>{e.label}</span><span>{e.present ? 'On' : 'Off'}</span></li>
      {#if !e.present && e.error}<li class="why">{e.error}</li>{/if}
    {/each}
    {#if s.status.subsError}<li class="why">{s.status.subsError}</li>{/if}
  </ul>
  <p class="quiet">{s.status.lastEventAt ? `Last heard from X on ${when(s.status.lastEventAt)}.` : 'Nothing has arrived from X yet.'}</p>
  <div class="row"><button class="btn plain" onclick={() => s.repair()} disabled={s.repairing}>{s.repairing ? 'Repairing' : 'Repair connection'}</button></div>
{:else if s.statusFailed}
  <p class="quiet">Could not check the connection.</p>
{:else}
  <span class="spinner"></span>
{/if}

<section class="gaps">
  <h3>Missed deliveries</h3>
  <p class="hint">X sometimes skips a delivery, and says nothing when it does. So every hour notime asks X to resend the last two hours; what you already have is skipped, and X does not bill a delivery twice in a day. If something older is on X but not here, ask for the last 24 hours.</p>
  <div class="row"><button class="btn plain" onclick={() => s.replay()} disabled={s.replaying}>{s.replaying ? 'Asking X' : 'Resend the last 24 hours'}</button></div>
  {#if s.replayNote}<p class="quiet" role="status">{s.replayNote}</p>{/if}
</section>

{#if s.log?.length}
  <section>
    <h3>Recent deliveries</h3>
    <ul class="checks log">
      {#each s.log as r}
        <li class:bad={r.kind === 'bad_signature' || r.kind === 'failed' || r.kind === 'missed'}>
          <span>{KIND[r.kind] ?? r.kind}{#if r.types} <span class="types">{what(r.types)}</span>{/if}</span>
          <span>{when(r.at)}</span>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .gaps { margin-top: 28px; }
  .types { color: var(--text-secondary); }
</style>
