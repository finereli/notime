<script lang="ts">
  // A short list of actions that slides up from the bottom, for a long press.
  // Tapping outside or Cancel closes it.
  import type { Snippet } from 'svelte'
  let { open, title = '', onclose, children }: { open: boolean; title?: string; onclose: () => void; children: Snippet } = $props()

  function key(e: KeyboardEvent) { if (open && e.key === 'Escape') onclose() }
</script>

<svelte:window onkeydown={key} />

{#if open}
  <div class="scrim" onclick={onclose} role="presentation"></div>
  <div class="sheet" role="menu" aria-label={title || 'Actions'}>
    {#if title}<p class="title">{title}</p>{/if}
    {@render children()}
    <button class="item cancel" onclick={onclose}>Cancel</button>
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.35); z-index: 60; animation: fade 0.15s ease-out; }
  .sheet {
    position: fixed; inset-inline: 0; bottom: 0; z-index: 61; max-width: 30rem; margin: 0 auto;
    padding: 8px 8px calc(var(--safe-bottom) + 8px); background: var(--bg-raised); border-radius: 18px 18px 0 0;
    box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.2); display: flex; flex-direction: column; animation: up 0.18s ease-out;
  }
  .title { padding: 10px 14px 6px; font-size: 0.8rem; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sheet :global(.item) {
    display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 0 14px; border-radius: 12px;
    font-size: 1rem; color: var(--text-primary); text-align: start; text-decoration: none;
  }
  .sheet :global(.item:hover) { background: var(--bg-hover); }
  .cancel { justify-content: center; color: var(--text-secondary) !important; margin-top: 4px; border-top: 1px solid var(--border); border-radius: 0 0 12px 12px !important; }
  @keyframes up { from { transform: translateY(100%); } }
  @keyframes fade { from { opacity: 0; } }
</style>
