<script lang="ts">
  import Avatar from '../components/Avatar.svelte'
  import Icon from '../components/Icon.svelte'
  import { notifications } from '../lib/notifications.svelte'
  import { VERB, collapse, displayName, who } from '../lib/collapse'
  import { ago } from '../lib/time'
  import { toasts } from '$shared/lib/toast.svelte'

  const rows = $derived(collapse(notifications.items))
  let loadingMore = $state(false)

  // Seeing the list is reading it. The rows keep their unread mark until the
  // next load, so you can still tell what is new on this visit.
  $effect(() => {
    if (notifications.loaded && notifications.unread) notifications.markRead()
  })

  const ICON = { repost: 'repeat', follow: 'person_add' } as const

  // Opening the list rereads it. The read is from our own database and free.
  notifications.load()

  async function more() {
    loadingMore = true
    try { await notifications.loadMore() } catch { toasts.error('Could not load more') } finally { loadingMore = false }
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
      <p class="quiet">Replies and mentions will show up here, and on your phone if you turn notifications on in settings.</p>
    </div>
  {:else}
    <ul>
      {#each rows as row (row.key)}
        {@const first = row.items[0]}
        <li class:unread={row.unread}>
          {#if row.type === 'reply' || row.type === 'mention' || row.type === 'quote'}
            <a class="post" href={`#/n/${encodeURIComponent(first.id)}`}>
              <Avatar src={first.avatar} name={displayName(first)} />
              <div class="main">
                <p class="head">
                  <strong>{displayName(first)}</strong>
                  <span>{VERB[row.type]}</span>
                  <time>{ago(row.created_at)}</time>
                </p>
                <p class="text" dir="auto">{first.text}</p>
                {#if first.target_text}
                  <p class="context" dir="auto">{first.target_text}</p>
                {/if}
                {#if first.replied_post_id}
                  <p class="replied"><Icon name="reply" size={14} /> You replied</p>
                {/if}
              </div>
            </a>
          {:else}
            <div class="activity">
              <span class="glyph"><Icon name={ICON[row.type]} size={20} /></span>
              <div class="main">
                <p class="head">
                  <strong>{who(row)}</strong>
                  <span>{VERB[row.type]}</span>
                  <time>{ago(row.created_at)}</time>
                </p>
                {#if first.target_text}
                  <p class="context" dir="auto">{first.target_text}</p>
                {/if}
              </div>
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

  .post, .activity { display: flex; gap: 12px; padding: 14px 18px; color: inherit; text-decoration: none; }
  .post { transition: background 0.15s; }
  .post:hover { background: var(--bg-hover); }
  .post:active { background: var(--bg-hover); }
  .glyph { width: 40px; height: 28px; flex: none; display: grid; place-items: center; color: var(--text-secondary); }
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
  .replied { display: flex; align-items: center; gap: 4px; margin-top: 6px; font-size: 0.75rem; color: var(--accent); }

  .empty { padding: 12vh 18px 0; }
  .empty h2 { font-family: var(--font-write); font-size: 1.5rem; font-weight: 400; margin-bottom: 6px; }
  .wait { display: grid; place-items: center; padding-top: 20vh; }
  .more { display: block; margin: 12px auto 0; min-height: 44px; padding: 0 18px; color: var(--accent); font-size: 0.9rem; }
  .link { color: var(--accent); text-decoration: underline; }
</style>
