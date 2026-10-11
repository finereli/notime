<script lang="ts">
  import { drafts } from '../lib/drafts.svelte'
  import { imageCount, preview } from '../lib/drafts-core'
  import { router } from '../lib/router.svelte'
  import { ago } from '../lib/time'

  // Deleting is two taps in place, never a system dialog.
  let confirming = $state<string | null>(null)

  function open(id: string, replyTo?: string) {
    if (replyTo?.startsWith('own:')) return router.go(`/p/${replyTo.slice(4)}`)
    if (replyTo?.startsWith('quote:')) return router.go(`/p/${replyTo.slice(6)}/quote`)
    if (replyTo) return router.go(`/n/${encodeURIComponent(replyTo)}`)
    drafts.open(id)
    router.go('/')
  }

  function meta(d: (typeof drafts.parked)[number]): string {
    const parts = [ago(new Date(d.updatedAt).toISOString())]
    if (d.replyTo) parts.unshift(d.replyTo.startsWith('quote:') ? 'Quote' : d.replyTo.startsWith('own:') ? 'Follow-up' : 'Reply')
    if (d.posts.length > 1) parts.push(`${d.posts.length} posts`)
    const images = imageCount(d)
    if (images) parts.push(images === 1 ? '1 image' : `${images} images`)
    if (d.poll) parts.push('poll')
    return parts.join(', ')
  }
</script>

<div class="page">
  {#if drafts.parked.length === 0}
    <div class="empty">
      <h2>No drafts.</h2>
      <p class="quiet">Whatever you start writing is kept on this device until you post it. Start a new post and the old one waits here.</p>
    </div>
  {:else}
    <ul>
      {#each drafts.parked as d (d.id)}
        <li>
          <button class="open" onclick={() => open(d.id, d.replyTo)}>
            <span class="text" dir="auto">{preview(d)}</span>
            <span class="meta">{meta(d)}</span>
          </button>
          {#if confirming === d.id}
            <button class="del sure" onclick={() => { drafts.remove(d.id); confirming = null }}>Delete</button>
            <button class="del" onclick={() => (confirming = null)}>Keep</button>
          {:else}
            <button class="del" onclick={() => (confirming = d.id)}>Delete</button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .page { padding-inline: 0; padding-top: 4px; }
  ul { list-style: none; }
  li { display: flex; align-items: center; border-bottom: 1px solid var(--border); padding-inline-end: 8px; }
  .open { flex: 1; min-width: 0; text-align: start; padding: 14px 18px; display: flex; flex-direction: column; gap: 4px; }
  .open:hover { background: var(--bg-hover); }
  .text {
    font-family: var(--font-write); font-size: 1.05rem; line-height: 1.4; overflow-wrap: anywhere;
    display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .meta { font-size: 0.75rem; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
  .del { flex: none; min-height: 44px; padding: 0 10px; font-size: 0.82rem; color: var(--text-secondary); }
  .del.sure { color: var(--danger); font-weight: 500; }
  .empty { padding: 12vh 18px 0; }
  .empty h2 { font-family: var(--font-write); font-size: 1.5rem; font-weight: 400; margin-bottom: 6px; }
</style>
