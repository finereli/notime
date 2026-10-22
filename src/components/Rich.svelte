<script lang="ts">
  // A post's text with its links resolved, its images, and the posts it
  // links to. Inline mode is for text inside a tappable row: no links of its
  // own (the row is the link), small images, and a one-line note for quotes.
  import Quote from './Quote.svelte'
  import { clip, rich, type Extra } from '../lib/rich'

  // `limit` cuts long text to that many characters. Inline, the row opens
  // the whole thing; otherwise "Show more" opens it in place.
  let { text, extra = null, inline = false, limit = 0 }: { text: string | null; extra?: Extra | null; inline?: boolean; limit?: number } = $props()
  const r = $derived(rich(text, extra))
  let open = $state(false)
  const shown = $derived(limit && !open ? clip(r.parts, limit) : { parts: r.parts, cut: false })
</script>

{#if r.parts.length}
  <span class="rich">{#each shown.parts as p}{#if p.t === 'text'}{p.s}{:else if inline}<span class="link">{p.label}</span>{:else}<a href={p.href} target="_blank" rel="noopener">{p.label}</a>{/if}{/each}{#if shown.cut}…{' '}{#if inline}<span class="more">more</span>{:else}<button class="more" onclick={() => (open = true)}>Show more</button>{/if}{/if}</span>
{/if}
{#if r.media.length}
  <span class="media" class:inline class:one={r.media.length === 1}>
    {#each r.media as m}
      {#if inline}
        <img src={m.url} alt={m.alt ?? ''} loading="lazy" referrerpolicy="no-referrer" />
      {:else}
        <a href={m.url} target="_blank" rel="noopener" class:video={m.type !== 'photo'}><img src={m.url} alt={m.alt ?? ''} loading="lazy" referrerpolicy="no-referrer" /></a>
      {/if}
    {/each}
  </span>
{/if}
{#each r.quotes as id (id)}
  {#if inline}
    <span class="quoting">Quoting a post</span>
  {:else}
    <Quote {id} />
  {/if}
{/each}

<style>
  .rich { white-space: pre-wrap; overflow-wrap: anywhere; }
  .link { color: var(--accent); }
  .more { color: var(--accent); font-size: 0.9em; }
  button.more { text-decoration: underline; }
  .rich a { color: var(--accent); text-decoration: none; overflow-wrap: anywhere; }
  .media { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-top: 8px; border-radius: 14px; overflow: hidden; max-width: 30rem; }
  .media.one { grid-template-columns: 1fr; }
  .media img { display: block; width: 100%; height: 100%; max-height: 22rem; object-fit: cover; background: var(--bg-hover); }
  .media a { display: block; position: relative; }
  .media a.video::after { content: '▶'; position: absolute; inset: 0; display: grid; place-items: center; color: #fff; font-size: 2rem; text-shadow: 0 1px 6px rgba(0, 0, 0, 0.6); }
  .media.inline { grid-template-columns: repeat(4, 64px); border-radius: 8px; gap: 4px; }
  .media.inline img { width: 64px; height: 64px; border-radius: 8px; }
  .quoting { display: block; margin-top: 6px; font-size: 0.8rem; color: var(--text-secondary); }
</style>
