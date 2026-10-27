<script lang="ts">
  // One conversation. Messages come from our database; the webhook adds new
  // ones as they arrive and the open screen rereads when a push lands.
  import Avatar from '../components/Avatar.svelte'
  import Icon from '../components/Icon.svelte'
  import FollowButton from '../components/FollowButton.svelte'
  import { autosize } from '../lib/autosize'
  import Rich from '../components/Rich.svelte'
  import { apiJson } from '../lib/api'
  import { auth } from '../lib/auth.svelte'
  import { displayName } from '../lib/collapse'
  import { dms, dmDraft, saveDmDraft, type Message, type Person } from '../lib/dms.svelte'
  import { explain } from '../lib/prefs.svelte'
  import { toasts } from '$shared/lib/toast.svelte'

  let { id }: { id: string } = $props()

  let person = $state<Person | null>(null)
  let messages = $state<Message[]>([])
  let loaded = $state(false)
  let missing = $state(false)
  let fetching = $state(false)
  // svelte-ignore state_referenced_locally
  let text = $state(dmDraft(id))
  let list = $state<HTMLElement>()

  const me = $derived(auth.user?.id)

  async function load() {
    try {
      const r = await apiJson<{ user: Person | null; items: Message[] }>(`/api/dms/${id}`)
      person = r.user
      const pending = messages.filter((m) => m.pending || m.failed)
      messages = [...r.items, ...pending]
      loaded = true
      if (!r.user && !r.items.length) missing = true
      if (r.items.some((m) => m.sender_id === id)) dms.markRead(id)
      scrollDown()
    } catch {
      if (!loaded) missing = true
    }
  }

  // Reread whenever the list reloads (a push arrived, the app came back).
  $effect(() => {
    dms.tick
    load()
  })

  function scrollDown() {
    requestAnimationFrame(() => list?.closest('.body')?.scrollTo({ top: 1e9 }))
  }

  async function fromX() {
    fetching = true
    try {
      await apiJson(`/api/dms/${id}/sync`, { method: 'POST' })
      await load()
    } catch (e) {
      toasts.error(explain(e, 'Could not ask X'))
    } finally {
      fetching = false
    }
  }

  function typed() {
    saveDmDraft(id, text)
  }


  async function send(retry?: Message) {
    const body = retry ? retry.text : text.trim()
    if (!body) return
    const local: Message = retry ?? { id: 'local:' + Date.now(), sender_id: me ?? '', text: body, created_at: new Date().toISOString(), pending: true }
    if (retry) { retry.pending = true; retry.failed = undefined }
    else {
      messages = [...messages, local]
      text = ''
      saveDmDraft(id, '')
    }
    scrollDown()
    try {
      const sent = await apiJson<Message>(`/api/dms/${id}`, { method: 'POST', body: { text: body } })
      messages = messages.map((m) => (m.id === local.id ? sent : m))
      dms.load()
    } catch (e) {
      messages = messages.map((m) => (m.id === local.id ? { ...m, pending: false, failed: explain(e, 'Not sent') } : m))
    }
  }

  function keydown(e: KeyboardEvent) {
    // Enter sends on a keyboard; on a phone the return key makes a new line.
    if (e.key === 'Enter' && !e.shiftKey && matchMedia('(pointer: fine)').matches) {
      e.preventDefault()
      send()
    }
  }

  const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
  const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
</script>

<div class="chat" bind:this={list}>
  {#if missing}
    <p class="quiet pad">This conversation is gone. <a href="#/messages">Back to messages</a></p>
  {:else if !loaded}
    <div class="wait"><span class="spinner"></span></div>
  {:else}
    {#if person}
      <header>
        <a class="person" href={`#/u/${id}`}>
          <Avatar src={person.avatar} name={displayName(person)} size={36} />
          <div>
            <strong>{displayName(person)}</strong>
            {#if person.username}<span class="handle">@{person.username}</span>{/if}
          </div>
        </a>
        <FollowButton {id} />
      </header>
    {/if}

    <div class="messages">
      <button class="load-more older" onclick={fromX} disabled={fetching}>{fetching ? 'Loading' : 'Load earlier messages'}</button>
      {#each messages as m, i (m.id)}
        {@const mine = m.sender_id === me}
        {#if i === 0 || day(m.created_at) !== day(messages[i - 1].created_at)}
          <p class="day">{day(m.created_at)}</p>
        {/if}
        <div class="msg" class:mine>
          <div class="bubble" dir="auto"><Rich text={m.text} extra={m.extra} /></div>
          <p class="meta">
            {#if m.failed}
              <span class="bad">{m.failed}</span> <button class="link" onclick={() => send(m)}>Try again</button>
            {:else if m.pending}
              Sending
            {:else}
              {clock(m.created_at)}
            {/if}
          </p>
        </div>
      {/each}
      {#if !messages.length}
        <p class="quiet pad">No messages here yet. Say hello.</p>
      {/if}
    </div>

    <form class="compose" onsubmit={(e) => { e.preventDefault(); send() }}>
      <textarea aria-label="Message" rows="1" placeholder="Message" bind:value={text} oninput={typed} onkeydown={keydown} use:autosize={{ value: text, max: 180 }} dir="auto"></textarea>
      <button class="send" aria-label="Send" disabled={!text.trim()}><Icon name="send" size={20} /></button>
    </form>
  {/if}
</div>

<style>
  .chat { display: flex; flex-direction: column; min-height: 100%; max-width: 38rem; margin: 0 auto; }
  .pad { padding: 18px; }
  .wait { display: grid; place-items: center; padding-top: 20vh; }

  /* Stays put while the messages scroll under it. */
  header { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: 10px; padding: 10px 18px; border-bottom: 1px solid var(--border); background: var(--bg-surface); }
  header div { display: flex; flex-direction: column; min-width: 0; }
  header strong { font-weight: 500; }
  .person { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; color: inherit; text-decoration: none; }
  .handle { font-size: 0.8rem; color: var(--text-secondary); }

  .messages { flex: 1; display: flex; flex-direction: column; gap: 4px; padding: 8px 14px 14px; }
  .older { align-self: center; margin: 4px auto 8px; }
  .day { align-self: center; margin: 10px 0 4px; font-size: 0.72rem; color: var(--text-secondary); }

  .msg { display: flex; flex-direction: column; align-items: flex-start; max-width: 82%; }
  .msg.mine { align-self: flex-end; align-items: flex-end; }
  .bubble {
    padding: 9px 13px; border-radius: 18px 18px 18px 6px; background: var(--bg-raised); border: 1px solid var(--border);
    font-size: 0.97rem; line-height: 1.42; white-space: pre-wrap; overflow-wrap: anywhere;
  }
  .mine .bubble { border-radius: 18px 18px 6px 18px; background: var(--accent); border-color: var(--accent); color: #fff; }
  :global(.dark) .mine .bubble { color: #10201c; }
  .meta { font-size: 0.68rem; color: var(--text-secondary); padding: 2px 6px 4px; font-variant-numeric: tabular-nums; }
  .bad { color: var(--danger); }
  .link { color: var(--accent); text-decoration: underline; font-size: inherit; }

  .compose {
    position: sticky; bottom: 0; display: flex; align-items: flex-end; gap: 8px;
    padding: 10px 12px calc(var(--safe-bottom) + 10px); background: var(--bg-surface); border-top: 1px solid var(--border);
  }
  textarea {
    flex: 1; min-width: 0; resize: none; min-height: 44px; max-height: 180px; padding: 11px 14px; border-radius: 22px;
    border: 1px solid var(--border); background: var(--bg-raised); line-height: 1.35; font-size: 1rem;
  }
  .send { width: 44px; height: 44px; flex: none; border-radius: 50%; background: var(--accent); color: #fff; display: grid; place-items: center; }
  :global(.dark) .send { color: #10201c; }
  .send:disabled { opacity: 0.35; }
</style>
