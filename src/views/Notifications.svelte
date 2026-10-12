<script lang="ts">
  import Avatar from '../components/Avatar.svelte'
  import Icon from '../components/Icon.svelte'
  import Rich from '../components/Rich.svelte'
  import { plain } from '../lib/rich'
  import { notifications } from '../lib/notifications.svelte'
  import { VERB, collapse, crowd, cumulative, displayName } from '../lib/collapse'
  import { explain } from '../lib/prefs.svelte'
  import { ago } from '../lib/time'
  import { toasts } from '$shared/lib/toast.svelte'

  const rows = $derived(collapse(notifications.items))
  let loadingMore = $state(false)

  // Seeing the list is reading it. The rows keep their unread mark until the
  // next load, so you can still tell what is new on this visit.
  $effect(() => {
    if (notifications.loaded && (notifications.unread || notifications.items.some((i) => !i.read))) notifications.markRead()
  })

  // Opening the list rereads it. The read is from our own database and free.
  notifications.load()

  async function more() {
    loadingMore = true
    try { await notifications.loadMore() } catch { toasts.error('Could not load more') } finally { loadingMore = false }
  }

  async function heart(id: string, on: boolean) {
    try { await notifications.like(id, on) } catch (e) { toasts.error(explain(e, 'X did not take the like')) }
  }
</script>

<div class="page">
  {#if !notifications.loaded}
    {#if notifications.failed}
      <p class="quiet empty">Could not load notifications. <button class="link" onclick={() => notifications.load()}>Try again</button></p>
    {:else}
      <div class="wait"><span class="spinner"></span></div>
    {/if}
  {:else if rows.length === 0}
    <div class="empty">
      <h2>Nothing yet.</h2>
      <p class="quiet">Replies, mentions and quotes will show up here, and on your phone if you turn notifications on in settings.</p>
    </div>
  {:else}
    <ul>
      {#each rows as row (row.key)}
        {@const last = row.items[row.items.length - 1]}
        {@const earlier = row.items.length - 1}
        <li class:unread={row.unread}>
          {#if cumulative(last)}
            <svelte:element this={last.post_id ? 'a' : 'div'} class="activity" href={last.post_id ? `#/p/${last.post_id}` : undefined}>
              <span class="glyph" class:heart-glyph={last.type === 'likes'}><Icon name={last.type === 'likes' ? 'favorite_fill' : 'person_add'} size={20} /></span>
              <div class="main">
                <p class="head">
                  {#if last.type === 'likes'}
                    <span class="who"><strong>{last.count}</strong> {last.count === 1 ? 'like' : 'likes'} on your post</span>
                  {:else}
                    <span class="who"><strong>{displayName(last)}</strong>{crowd(last)} {VERB[last.type]}</span>
                  {/if}
                  <time>{ago(last.created_at)}</time>
                </p>
                {#if last.target_text}<p class="context" dir="auto">{plain(last.target_text, last.target_extra)}</p>{/if}
              </div>
            </svelte:element>
          {:else}
          <a class="post" href={`#/n/${encodeURIComponent(last.id)}`}>
            <Avatar src={last.avatar} name={displayName(last)} />
            <div class="main">
              <p class="head">
                <strong>{displayName(last)}</strong>
                <span>{VERB[row.type]}</span>
                <time>{ago(row.created_at)}</time>
              </p>
              {#if earlier}
                <p class="thread"><Icon name="forum" size={14} /> {earlier === 1 ? 'Continues a conversation' : `${earlier + 1} replies in this conversation`}</p>
              {/if}
              <div class="text" dir="auto"><Rich text={last.text} extra={last.extra} inline /></div>
              {#if last.target_text}
                <p class="context" dir="auto">{plain(last.target_text, last.target_extra)}</p>
              {/if}
            </div>
          </a>
          <div class="foot">
            {#if last.replied_post_id || last.answered}
              <span class="replied"><Icon name="reply" size={14} /> You replied</span>
            {/if}
            <button class="heart" class:on={last.liked} aria-pressed={!!last.liked} aria-label={last.liked ? 'Unlike' : 'Like'} onclick={() => heart(last.id, !last.liked)}>
              <Icon name={last.liked ? 'favorite_fill' : 'favorite'} size={18} />
            </button>
          </div>
          {/if}
        </li>
      {/each}
    </ul>
    {#if notifications.more}
      <button class="more" onclick={more} disabled={loadingMore}>{loadingMore ? 'Loading' : 'Show earlier'}</button>
    {/if}
  {/if}
</div>

<style>
  .page { padding-inline: 0; padding-top: 4px; }
  ul { list-style: none; }
  li { border-bottom: 1px solid var(--border); position: relative; }
  li.unread::before { content: ''; position: absolute; inset-block: 0; inset-inline-start: 0; width: 3px; background: var(--mark); }

  .post { display: flex; gap: 12px; padding: 14px 18px 0; color: inherit; text-decoration: none; }
  .activity { display: flex; gap: 12px; padding: 12px 18px; color: inherit; text-decoration: none; }
  a.activity:hover, a.activity:active { background: var(--bg-hover); }
  .glyph { width: 40px; height: 24px; flex: none; display: grid; place-items: center; color: var(--text-secondary); }
  .glyph.heart-glyph { color: var(--heart); }
  .activity .context { -webkit-line-clamp: 1; line-clamp: 1; }
  /* The whole sentence wraps; nothing in it is cut. */
  .head .who { flex: 1; min-width: 0; line-height: 1.4; }
  .head .who strong { overflow: visible; white-space: normal; }
  .post { transition: background 0.15s; }
  .post:hover { background: var(--bg-hover); }
  .post:active { background: var(--bg-hover); }
  .main { flex: 1; min-width: 0; }

  .head { display: flex; align-items: baseline; gap: 6px; font-size: 0.85rem; color: var(--text-secondary); }
  .head strong { font-weight: 500; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .head span { flex: none; }
  .head time { margin-inline-start: auto; flex: none; font-size: 0.75rem; font-variant-numeric: tabular-nums; }

  .text { margin-top: 3px; font-size: 0.98rem; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
  .context {
    margin-top: 6px; padding-inline-start: 10px; border-inline-start: 2px solid var(--border);
    font-size: 0.82rem; line-height: 1.4; color: var(--text-secondary);
    display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .thread { display: flex; align-items: center; gap: 4px; margin-top: 2px; font-size: 0.75rem; color: var(--text-secondary); }

  /* Outside the link, so the heart is its own tap target. Lined up with the text. */
  .foot { display: flex; align-items: center; gap: 8px; padding: 0 8px 2px 70px; min-height: 40px; }
  .replied { display: flex; align-items: center; gap: 4px; font-size: 0.75rem; color: var(--accent); }
  .heart { margin-inline-start: auto; width: 44px; height: 40px; display: grid; place-items: center; color: var(--text-secondary); }
  .heart.on { color: var(--heart); }

  .empty { padding: 12vh 18px 0; }
  .empty h2 { font-family: var(--font-write); font-size: 1.5rem; font-weight: 400; margin-bottom: 6px; }
  .wait { display: grid; place-items: center; padding-top: 20vh; }
  .more { display: block; margin: 12px auto 0; min-height: 44px; padding: 0 18px; color: var(--accent); font-size: 0.9rem; }
  .link { color: var(--accent); text-decoration: underline; }
</style>
