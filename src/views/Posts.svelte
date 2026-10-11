<script lang="ts">
  import Icon from '../components/Icon.svelte'
  import { posts, postTime } from '../lib/posts.svelte'
  import { ago } from '../lib/time'
  import { toasts } from '$shared/lib/toast.svelte'

  let busy = $state(false)
  if (!posts.loaded) posts.load()

  async function earlier() {
    busy = true
    try { await posts.earlier() } catch { toasts.error('Could not load earlier posts') } finally { busy = false }
  }
</script>

<div class="page">
  {#if !posts.loaded}
    {#if posts.failed}
      <p class="quiet empty">Could not load your posts. <button class="link" onclick={() => posts.load()}>Try again</button></p>
    {:else}
      <div class="wait"><span class="spinner"></span></div>
    {/if}
  {:else if posts.items.length === 0}
    <div class="empty">
      <h2>No posts yet.</h2>
      <p class="quiet">What you post will be listed here, so you can come back and add to it.</p>
    </div>
  {:else}
    <ul>
      {#each posts.items as p (p.id)}
        <li>
          <a class="text" href={`#/p/${p.id}`} dir="auto">{p.text}</a>
          <div class="foot">
            <time>{ago(postTime(p))}</time>
            <a href={`#/p/${p.id}`}><Icon name="reply" size={16} /> Follow up</a>
            <a href={`#/p/${p.id}/quote`}><Icon name="format_quote" size={16} /> Quote</a>
          </div>
        </li>
      {/each}
    </ul>
    {#if posts.more}
      <button class="more" onclick={earlier} disabled={busy}>{busy ? 'Loading' : 'Show earlier'}</button>
    {/if}
  {/if}
</div>

<style>
  .page { padding-inline: 0; padding-top: 4px; }
  ul { list-style: none; }
  li { border-bottom: 1px solid var(--border); padding: 14px 18px 4px; }
  .text {
    display: -webkit-box; -webkit-line-clamp: 6; line-clamp: 6; -webkit-box-orient: vertical; overflow: hidden;
    color: inherit; text-decoration: none; font-size: 0.98rem; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere;
  }
  .foot { display: flex; align-items: center; gap: 18px; font-size: 0.8rem; color: var(--text-secondary); }
  .foot time { margin-inline-end: auto; font-size: 0.75rem; font-variant-numeric: tabular-nums; }
  .foot a { display: inline-flex; align-items: center; gap: 5px; min-height: 44px; text-decoration: none; }
  .empty { padding: 12vh 18px 0; }
  .empty h2 { font-family: var(--font-write); font-size: 1.5rem; font-weight: 400; margin-bottom: 6px; }
  .wait { display: grid; place-items: center; padding-top: 20vh; }
  .more { display: block; margin: 12px auto 0; min-height: 44px; padding: 0 18px; color: var(--accent); font-size: 0.9rem; }
  .link { color: var(--accent); text-decoration: underline; }
</style>
