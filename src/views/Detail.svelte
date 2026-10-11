<script lang="ts">
  import Avatar from '../components/Avatar.svelte'
  import Composer from '../components/Composer.svelte'
  import Icon from '../components/Icon.svelte'
  import { apiJson } from '../lib/api'
  import { drafts } from '../lib/drafts.svelte'
  import { replyId } from '../lib/drafts-core'
  import { notifications } from '../lib/notifications.svelte'
  import { displayName, type Item } from '../lib/collapse'
  import { ago } from '../lib/time'
  import type { Sent } from '../lib/send.svelte'

  let { id }: { id: string } = $props()

  // Show what the list already knows at once, then ask the server, which
  // fills in the author or the original post if they were missing.
  let item = $state<Item | null>(notifications.items.find((i) => i.id === id) ?? null)
  let missing = $state(false)
  let sent = $state<Sent | null>(null)

  $effect(() => {
    apiJson<Item>(`/api/notifications/${encodeURIComponent(id)}`)
      .then((full) => (item = full))
      .catch(() => { if (!item) missing = true })
  })

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
    {#if item.target_text}
      <p class="yours" dir="auto"><span>You wrote</span>{item.target_text}</p>
    {/if}

    <article>
      <header>
        <Avatar src={item.avatar} name={displayName(item)} size={44} />
        <div>
          <strong>{displayName(item)}</strong>
          {#if item.username}<span class="handle">@{item.username}</span>{/if}
        </div>
        <time>{ago(item.created_at)}</time>
      </header>
      <p class="text" dir="auto">{item.text}</p>
      {#if item.username && item.post_id}
        <a class="out" href={`https://x.com/${item.username}/status/${item.post_id}`} target="_blank" rel="noopener">Open on X <Icon name="open_in_new" size={14} /></a>
      {/if}
    </article>

    {#if sent}
      <p class="replied"><Icon name="check_circle" size={20} /> Replied. <a href={sent.url} target="_blank" rel="noopener">Open on X</a></p>
    {:else if draft}
      {#if item.replied_post_id}
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
  header div { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  header strong { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .handle, time { font-size: 0.8rem; color: var(--text-secondary); }
  time { font-variant-numeric: tabular-nums; }

  .text { margin-top: 12px; font-size: 1.12rem; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
  .out { display: inline-flex; align-items: center; gap: 5px; margin-top: 8px; min-height: 36px; font-size: 0.8rem; text-decoration: none; color: var(--text-secondary); }

  .reply { margin-top: 18px; padding: 14px 16px 8px; border: 1px solid var(--border); border-radius: 16px; background: var(--bg-raised); }
  .again { margin-top: 14px; }
  .replied { display: flex; align-items: center; gap: 8px; margin-top: 22px; color: var(--accent); font-size: 0.95rem; }
  .wait { display: grid; place-items: center; padding-top: 20vh; }
</style>
