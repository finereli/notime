<script lang="ts">
  // A post that another one links to or quotes, as a card that opens it.
  // Looked up once per session here, and once ever on the server.
  import Avatar from './Avatar.svelte'
  import Rich from './Rich.svelte'
  import { displayName } from '../lib/collapse'
  import { lookPost, type LinkedPost } from '../lib/linked'

  let { id }: { id: string } = $props()
  let post = $state<LinkedPost | null>(null)
  let failed = $state(false)
  $effect(() => { lookPost(id).then((p) => (post = p)).catch(() => (failed = true)) })
</script>

<a class="card" href={`#/t/${id}`}>
  {#if post}
    <span class="who"><Avatar src={post.avatar} name={displayName(post)} size={20} /><strong>{displayName(post)}</strong>{#if post.username}<span>@{post.username}</span>{/if}</span>
    <span class="text"><Rich text={post.text} extra={post.extra} inline /></span>
  {:else if failed}
    <span class="quiet">A post that could not be loaded</span>
  {:else}
    <span class="quiet">Loading the post</span>
  {/if}
</a>

<style>
  .card { display: block; margin-top: 8px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 14px; color: inherit; text-decoration: none; background: var(--bg-raised); }
  .card:hover { background: var(--bg-hover); }
  .who { display: flex; align-items: center; gap: 6px; font-size: 0.82rem; color: var(--text-secondary); min-width: 0; }
  .who strong { font-weight: 500; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .who span { flex: none; }
  .text { display: block; margin-top: 4px; font-size: 0.92rem; line-height: 1.45; }
</style>
