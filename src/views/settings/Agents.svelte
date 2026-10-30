<script lang="ts">
  import { settings as s, when } from '../../lib/settings.svelte'
  let copied = $state(false)

  async function copy() {
    if (!s.agents) return
    try { await navigator.clipboard.writeText(s.agents.url); copied = true; setTimeout(() => (copied = false), 2000) } catch {}
  }
</script>

<p class="quiet">An AI agent can read notime (notifications, conversations, posts, messages, cost) but never post or send. Give it this address; it will ask you to sign in with X to allow it.</p>
{#if s.agents}
  <div class="row"><code class="url">{s.agents.url}</code><button class="btn plain" onclick={copy}>{copied ? 'Copied' : 'Copy'}</button></div>
  {#if s.agents.items.length}
    <ul class="checks agents">
      {#each s.agents.items as a (a.id)}
        <li>
          <span>{a.name ?? 'An agent'}<span class="when">{a.last_used ? ` · used ${when(a.last_used + 'Z')}` : ' · not used yet'}</span></span>
          <button class="revoke" onclick={() => s.revokeAgent(a.id)}>Revoke</button>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="quiet">No agent has access.</p>
  {/if}
{:else}
  <span class="spinner"></span>
{/if}

<style>
  .url { flex: 1; min-width: 0; padding: 10px 12px; border-radius: 12px; background: var(--bg-hover); font-size: 0.8rem; overflow-wrap: anywhere; align-self: center; }
  .when { color: var(--text-secondary); }
  .agents li { align-items: center; }
  .revoke { color: var(--danger); font-size: 0.82rem; min-height: 32px; flex: none; }
</style>
