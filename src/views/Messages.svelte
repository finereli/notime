<script lang="ts">
  // Direct messages: one row per person, newest first. Starting a new
  // conversation takes a username, because there is no one to browse.
  import Avatar from '../components/Avatar.svelte'
  import { apiJson } from '../lib/api'
  import { auth } from '../lib/auth.svelte'
  import { displayName } from '../lib/collapse'
  import { dms, type Conversation, type Person } from '../lib/dms.svelte'
  import { longpress } from '../lib/longpress'
  import Sheet from '../components/Sheet.svelte'
  import Icon from '../components/Icon.svelte'
  import { explain, prefs } from '../lib/prefs.svelte'
  import { router } from '../lib/router.svelte'
  import { ago } from '../lib/time'
  import { plain } from '../lib/rich'

  let starting = $state(false)
  let username = $state('')
  let finding = $state(false)
  let error = $state('')

  dms.load()

  // The long-press menu on a conversation.
  let menu = $state<Conversation | null>(null)
  const isUnread = (c: Conversation) => c.unread > 0 || !!c.marked
  function toggle() {
    if (!menu) return
    dms.mark(menu.partner_id, !isUnread(menu))
    menu = null
  }

  const needsSignIn = $derived(prefs.missingScopes.some((s) => s.startsWith('dm.')))

  async function start(e: SubmitEvent) {
    e.preventDefault()
    finding = true
    error = ''
    try {
      const p = await apiJson<Person>('/api/dms/find', { method: 'POST', body: { username } })
      router.go(`/m/${p.id}`)
    } catch (err) {
      error = explain(err, 'Could not find that account')
    } finally {
      finding = false
    }
  }
</script>

<div class="page">
  {#if needsSignIn}
    <div class="empty">
      <h2>Messages need one more yes.</h2>
      <p class="quiet">You signed in before notime asked X for your messages. Sign in again and X will ask you to allow it.</p>
      <p><button class="btn" onclick={() => auth.signIn()}>Sign in again</button></p>
    </div>
  {:else if !dms.loaded}
    {#if dms.failed}
      <p class="quiet empty">Could not load messages. <button class="link" onclick={() => dms.load()}>Try again</button></p>
    {:else}
      <div class="wait"><span class="spinner"></span></div>
    {/if}
  {:else}
    {#if starting}
      <form class="start" onsubmit={start}>
        <label for="to">To</label>
        <input id="to" placeholder="@username" autocomplete="off" autocapitalize="off" spellcheck="false" bind:value={username} />
        <button class="btn" disabled={finding || !username.trim()}>{finding ? 'Finding' : 'Write'}</button>
      </form>
      {#if error}<p class="error-line" role="alert">{error}</p>{/if}
    {/if}

    {#if dms.chat === 'locked'}
      <p class="locked">X keeps your messages encrypted now. <a class="link" href="#/settings">Unlock them in Settings</a> to read and answer them here.</p>
    {/if}

    {#if dms.items.length === 0}
      <div class="empty">
        <h2>No messages.</h2>
        <p class="quiet">Messages people send you will show up here.</p>
      </div>
    {:else}
      <ul>
        {#each dms.items as c (c.partner_id)}
          <li class:unread={c.unread > 0 || !!c.marked}>
            <a href={`#/m/${c.partner_id}`} use:longpress={() => (menu = c)}>
              <span class="face" role="link" tabindex="-1" onclick={(e) => { e.preventDefault(); e.stopPropagation(); router.go(`/u/${c.partner_id}`) }} onkeydown={() => {}}><Avatar src={c.avatar} name={displayName(c)} /></span>
              <div class="main">
                <p class="head"><strong>{displayName(c)}</strong><time>{ago(c.created_at)}</time></p>
                <p class="text" dir="auto">{c.sender_id === auth.user?.id ? 'You: ' : ''}{plain(c.text, c.extra)}</p>
              </div>
              {#if c.unread > 0}<span class="count">{c.unread}</span>{:else if c.marked}<span class="count dot" aria-label="Marked unread"></span>{/if}
            </a>
          </li>
        {/each}
      </ul>
    {/if}

    {#if !starting}
      <button class="load-more" onclick={() => (starting = true)}>New message</button>
    {/if}

    <Sheet open={!!menu} title={menu ? displayName(menu) : ''} onclose={() => (menu = null)}>
      {#if menu}
        <button class="item" onclick={toggle}>
          <Icon name={isUnread(menu) ? 'drafts' : 'mark_email_unread'} size={22} />
          {isUnread(menu) ? 'Mark as read' : 'Mark as unread'}
        </button>
        <a class="item" href={`#/u/${menu.partner_id}`} onclick={() => (menu = null)}><Icon name="person" size={22} />View profile</a>
      {/if}
    </Sheet>
  {/if}
</div>

<style>
  .page { padding-inline: 0; padding-top: 4px; }
  ul { list-style: none; }
  li { border-bottom: 1px solid var(--border); position: relative; }
  li.unread::before { content: ''; position: absolute; inset-block: 0; inset-inline-start: 0; width: 3px; background: var(--mark); }
  /* No text selection or iOS callout on a long press. */
  li > a { -webkit-touch-callout: none; user-select: none; }
  .count.dot { min-width: 12px; width: 12px; height: 12px; padding: 0; }
  li > a { display: flex; align-items: center; gap: 12px; padding: 14px 18px; color: inherit; text-decoration: none; transition: background 0.15s; }
  li > a:hover, li > a:active { background: var(--bg-hover); }
  .main { flex: 1; min-width: 0; }
  .head { display: flex; align-items: baseline; gap: 6px; font-size: 0.85rem; color: var(--text-secondary); }
  .head strong { font-weight: 500; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .head time { margin-inline-start: auto; flex: none; font-size: 0.75rem; font-variant-numeric: tabular-nums; }
  .text { margin-top: 2px; font-size: 0.92rem; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  li.unread .text { color: var(--text-primary); }
  .count { flex: none; min-width: 22px; height: 22px; padding: 0 6px; border-radius: 11px; background: var(--accent); color: #fff; font-size: 0.75rem; display: grid; place-items: center; font-variant-numeric: tabular-nums; }
  :global(.dark) .count { color: #10201c; }

  .start { display: flex; align-items: center; gap: 10px; padding: 12px 18px; border-bottom: 1px solid var(--border); }
  .start label { font-size: 0.85rem; color: var(--text-secondary); }
  .start input { flex: 1; min-width: 0; min-height: 44px; padding: 0 12px; border: 1px solid var(--border); border-radius: 12px; background: var(--bg-raised); }
  .error-line { padding: 8px 18px 0; color: var(--danger); font-size: 0.85rem; }
  .btn { min-height: 44px; padding: 0 18px; border-radius: 22px; background: var(--accent); color: #fff; font-size: 0.9rem; font-weight: 500; }
  :global(.dark) .btn { color: #10201c; }
  .btn:disabled { opacity: 0.45; }

  .empty { padding: 12vh 18px 0; display: flex; flex-direction: column; gap: 10px; }
  .empty h2 { font-family: var(--font-write); font-size: 1.5rem; font-weight: 400; }
  .wait { display: grid; place-items: center; padding-top: 20vh; }
  .link { color: var(--accent); text-decoration: underline; }
  .locked { padding: 12px 18px; border-bottom: 1px solid var(--border); font-size: 0.9rem; color: var(--text-secondary); }
  .locked a { display: inline; padding: 0; }
</style>
