<script lang="ts">
  import Composer from '../components/Composer.svelte'
  import Icon from '../components/Icon.svelte'
  import { drafts } from '../lib/drafts.svelte'
  import type { Sent } from '../lib/send.svelte'

  let { onposted }: { onposted?: () => void } = $props()
  let sent = $state<Sent | null>(null)

  function done(result: Sent) {
    drafts.remove(drafts.current.id)
    sent = result
    onposted?.()
  }
</script>

<div class="page">
  {#if sent}
    <div class="done">
      <span class="tick"><Icon name="check_circle" size={40} /></span>
      <h2>{sent.ids.length > 1 ? `Posted, all ${sent.ids.length}.` : 'Posted.'}</h2>
      <p class="quiet">It is out. There is nothing else to check here.</p>
      <div class="actions">
        <button class="primary" onclick={() => (sent = null)}>Write another</button>
        <a href={sent.url} target="_blank" rel="noopener">Open on X <Icon name="open_in_new" size={16} /></a>
      </div>
    </div>
  {:else}
    {#key drafts.current.id}
      <Composer draft={drafts.current} onsent={done} />
    {/key}
    {#if drafts.parked.length}
      <p class="quiet parked">
        <a href="#/drafts">{drafts.parked.length === 1 ? '1 draft' : `${drafts.parked.length} drafts`} waiting</a>
      </p>
    {/if}
  {/if}
</div>

<style>
  .done { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding-top: 12vh; }
  .tick { color: var(--accent); margin-inline-start: -3px; }
  h2 { font-family: var(--font-write); font-size: 1.7rem; font-weight: 400; }
  .actions { display: flex; align-items: center; gap: 20px; margin-top: 18px; flex-wrap: wrap; }
  .primary { min-height: 44px; padding: 0 22px; border-radius: 22px; background: var(--accent); color: #fff; font-weight: 500; }
  :global(.dark) .primary { color: #10201c; }
  .actions a { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; font-size: 0.9rem; text-decoration: none; }
  .parked { margin-top: 22px; }
  .parked a { display: inline-block; padding: 10px 0; }
</style>
