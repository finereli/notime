<script lang="ts">
  import Avatar from '../components/Avatar.svelte'
  import Composer from '../components/Composer.svelte'
  import FollowButton from '../components/FollowButton.svelte'
  import Icon from '../components/Icon.svelte'
  import Rich from '../components/Rich.svelte'
  import { plain } from '../lib/rich'
  import { apiJson } from '../lib/api'
  import { drafts } from '../lib/drafts.svelte'
  import { replyId } from '../lib/drafts-core'
  import { notifications } from '../lib/notifications.svelte'
  import { displayName, type Item } from '../lib/collapse'
  import { explain } from '../lib/prefs.svelte'
  import { ago } from '../lib/time'
  import type { Sent } from '../lib/send.svelte'
  import { toasts } from '$shared/lib/toast.svelte'

  let { id }: { id: string } = $props()

  // Show what the list already knows at once, then ask the server, which
  // fills in the author or the original post if they were missing.
  let item = $state<Item | null>(notifications.items.find((i) => i.id === id) ?? null)
  let chain = $state<Item[]>([])
  // A reply to someone else under your post: the posts above it, back to yours.
  interface Above { id: string; author_id: string; text: string; created_at: string; extra?: Item['extra']; username: string | null; name: string | null; avatar: string | null; mine: boolean }
  let thread = $state<Above[]>([])
  let missing = $state(false)
  let sent = $state<Sent | null>(null)

  $effect(() => {
    apiJson<Item & { chain: Item[]; thread?: Above[] }>(`/api/notifications/${encodeURIComponent(id)}`)
      .then(({ chain: before, thread: above, ...full }) => { item = full; chain = before; thread = above ?? [] })
      .catch(() => { if (!item) missing = true })
  })

  async function heart() {
    if (!item) return
    const on = !item.liked
    item.liked = on
    try {
      await notifications.like(item.id, on)
    } catch (e) {
      item.liked = !on
      toasts.error(explain(e, 'X did not take the like'))
    }
  }

  // Made here, not inside a derived: creating a draft writes state. The
  // parent keys this component on the id, so reading it once is right.
  // svelte-ignore state_referenced_locally
  drafts.reply(id)
  const draft = $derived(drafts.state.drafts[replyId(id)])

  function done(result: Sent) {
    sent = result
    notifications.markReplied(id, result.ids[0])
    if (item) item.replied_post_id = result.ids[0]
    drafts.remove(replyId(id))
  }
</script>

<div class="page">
  {#if item}
    <!-- The conversation so far, oldest first: what you wrote, what they said. -->
    {#each chain as c (c.id)}
      {#if c.target_text}<p class="yours" dir="auto"><span>You</span>{plain(c.target_text, c.target_extra)}</p>{/if}
      <div class="earlier">
        <a href={`#/u/${c.actor_id}`} aria-label={displayName(c)}><Avatar src={c.avatar} name={displayName(c)} size={28} /></a>
        <div>
          <p class="who"><strong>{displayName(c)}</strong> <time>{ago(c.created_at)}</time></p>
          <p dir="auto"><Rich text={c.text} extra={c.extra} limit={280} /></p>
        </div>
      </div>
    {/each}
    {#each thread as t (t.id)}
      {#if t.mine}
        <p class="yours" dir="auto"><span>You wrote</span>{plain(t.text, t.extra)}</p>
      {:else}
        <div class="earlier">
          <a href={`#/u/${t.author_id}`} aria-label={displayName(t)}><Avatar src={t.avatar} name={displayName(t)} size={28} /></a>
          <div>
            <p class="who"><strong>{displayName(t)}</strong> <time>{ago(t.created_at)}</time></p>
            <p dir="auto"><Rich text={t.text} extra={t.extra} limit={280} /></p>
          </div>
        </div>
      {/if}
    {/each}
    {#if item.target_text}
      <p class="yours" dir="auto"><span>{chain.length ? 'You' : 'You wrote'}</span>{plain(item.target_text, item.target_extra)}</p>
    {/if}

    <article>
      <header>
        <a class="person" href={`#/u/${item.actor_id}`}>
          <Avatar src={item.avatar} name={displayName(item)} size={44} />
          <div>
            <strong>{displayName(item)}</strong>
            {#if item.username}<span class="handle">@{item.username}</span>{/if}
          </div>
        </a>
        <FollowButton id={item.actor_id} />
        <time>{ago(item.created_at)}</time>
      </header>
      <div class="text" dir="auto"><Rich text={item.text} extra={item.extra} limit={280} /></div>
      <div class="actions">
        {#if item.username && item.post_id}
          <a class="out" href={`https://x.com/${item.username}/status/${item.post_id}`} target="_blank" rel="noopener">Open on X <Icon name="open_in_new" size={14} /></a>
        {/if}
        <button class="heart" class:on={item.liked} aria-pressed={!!item.liked} onclick={heart}>
          <Icon name={item.liked ? 'favorite_fill' : 'favorite'} size={18} /> {item.liked ? 'Liked' : 'Like'}
        </button>
      </div>
    </article>

    {#if sent}
      <p class="replied"><Icon name="check_circle" size={20} /> Replied. <a href={sent.url} target="_blank" rel="noopener">Open on X</a></p>
    {:else if draft}
      {#if item.replied_post_id || item.answered}
        <p class="quiet again">You already replied to this. You can reply again.</p>
      {/if}
      <div class="reply">
        <Composer {draft} reply={{ postId: item.post_id!, notificationId: item.id }} placeholder={`Reply to ${displayName(item)}`} onsent={done} />
      </div>
    {/if}
  {:else if missing}
    <p class="quiet">This notification is gone. <a href="#/notifications">Back to the list</a></p>
  {:else}
    <div class="wait"><span class="spinner"></span></div>
  {/if}
</div>

<style>
  .yours {
    font-size: 0.88rem; line-height: 1.45; color: var(--text-secondary); white-space: pre-wrap; overflow-wrap: anywhere;
    padding-inline-start: 12px; border-inline-start: 2px solid var(--border); margin-bottom: 18px;
  }
  .yours span { display: block; font-size: 0.75rem; margin-bottom: 2px; }

  header { display: flex; align-items: center; gap: 12px; }
  .person { flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px; color: inherit; text-decoration: none; }
  header .person div { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  header strong { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .handle, time { font-size: 0.8rem; color: var(--text-secondary); }
  time { font-variant-numeric: tabular-nums; }

  .text { margin-top: 12px; font-size: 1.12rem; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
  .earlier { display: flex; gap: 10px; margin-bottom: 14px; font-size: 0.9rem; line-height: 1.45; }
  .earlier > div { flex: 1; min-width: 0; }
  .earlier p { white-space: pre-wrap; overflow-wrap: anywhere; }
  .earlier .who { font-size: 0.8rem; color: var(--text-secondary); }
  .earlier .who strong { font-weight: 500; color: var(--text-primary); }

  .actions { display: flex; align-items: center; gap: 16px; margin-top: 8px; }
  .heart { display: inline-flex; align-items: center; gap: 5px; min-height: 36px; font-size: 0.8rem; color: var(--text-secondary); margin-inline-start: auto; }
  .heart.on { color: var(--heart); }
  .out { display: inline-flex; align-items: center; gap: 5px; min-height: 36px; font-size: 0.8rem; text-decoration: none; color: var(--text-secondary); }

  .reply { margin-top: 18px; padding: 14px 16px 8px; border: 1px solid var(--border); border-radius: 16px; background: var(--bg-raised); }
  .again { margin-top: 14px; }
  .replied { display: flex; align-items: center; gap: 8px; margin-top: 22px; color: var(--accent); font-size: 0.95rem; }
  .wait { display: grid; place-items: center; padding-top: 20vh; }
</style>
