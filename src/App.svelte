<!-- pwa-kit: shell/src/App.svelte v9 -->
<script lang="ts">
  // Shell: login gate, top bar, one scrolling body, drawer. See
  // reference/shell.md. The app has three places to be and no feed.
  import TopBar from '$shared/ui/TopBar.svelte'
  import Drawer from '$shared/ui/Drawer.svelte'
  import ResetButton from '$shared/ui/ResetButton.svelte'
  import Toast from '$shared/ui/Toast.svelte'
  import { isDark, setDarkMode } from '$shared/lib/theme'
  import Icon from './components/Icon.svelte'
  import InstallBanner from './components/InstallBanner.svelte'
  import Avatar from './components/Avatar.svelte'
  import Login from './views/Login.svelte'
  import Write from './views/Write.svelte'
  import Notifications from './views/Notifications.svelte'
  import Detail from './views/Detail.svelte'
  import Posts from './views/Posts.svelte'
  import Post from './views/Post.svelte'
  import Settings from './views/Settings.svelte'
  import Messages from './views/Messages.svelte'
  import Chat from './views/Chat.svelte'
  import Profile from './views/Profile.svelte'
  import { apiJson } from './lib/api'
  import { keepPush } from './lib/push'
  import { auth, type User } from './lib/auth.svelte'
  import { dms } from './lib/dms.svelte'
  import { notifications } from './lib/notifications.svelte'
  import { posts } from './lib/posts.svelte'
  import { prefs } from './lib/prefs.svelte'
  import { SECTIONS, router } from './lib/router.svelte'
  import { toasts } from '$shared/lib/toast.svelte'

  auth.init()
  router.start()

  let menuOpen = $state(false)
  let dark = $state(isDark())
  let engaged = $state(false)
  router.onChange(() => (menuOpen = false))

  const view = $derived(router.route.view)
  const detailId = $derived(router.route.view === 'detail' ? router.route.id : '')
  const postRoute = $derived(router.route.view === 'post' ? router.route : null)
  const chatId = $derived(router.route.view === 'chat' ? router.route.id : '')
  const profileId = $derived(router.route.view === 'profile' ? router.route.id : '')
  const section = $derived(router.route.view === 'settings' ? router.route.section : null)
  const title = $derived({ write: 'Write', notifications: 'Notifications', detail: 'Reply', posts: 'Posts', post: 'Post', settings: 'Settings', messages: 'Messages', chat: 'Message', profile: 'Profile' }[view])
  const entries = $derived([
    { label: 'Write', hash: '/', current: view === 'write' },
    { label: 'Notifications', hash: '/notifications', current: view === 'notifications' || view === 'detail', count: notifications.unread || undefined },
    { label: 'Messages', hash: '/messages', current: view === 'messages' || view === 'chat', count: dms.unread || undefined },
    { label: 'Posts', hash: '/posts', current: view === 'posts' || view === 'post' },
    { label: 'Settings', hash: '/settings', current: view === 'settings' },
  ])

  // Revalidate the stored session in the background. The app is already on
  // screen from what the device remembers; a dead session drops to login.
  async function refresh() {
    if (!auth.signedIn) return
    try {
      const me = await apiJson<{ user: User; unread: number; unreadDms: number; longPosts: boolean; missingScopes: string[] }>('/api/me')
      auth.setUser(me.user)
      prefs.set(me.longPosts, me.missingScopes)
      notifications.setUnread(me.unread, me.unreadDms)
    } catch {}
    notifications.load()
    dms.load()
  }
  refresh()
  // Push lost to a reset or rotated by the browser comes back on its own.
  keepPush()
  auth.onChange(() => auth.signedIn && keepPush())
  auth.onChange(refresh)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refresh())

  // The service worker tells an open app when a push arrived or was tapped.
  navigator.serviceWorker?.addEventListener('message', (e) => {
    if (e.data?.type === 'push') { notifications.load(); dms.load() }
    if (e.data?.type === 'open' && typeof e.data.url === 'string') {
      location.hash = e.data.url.replace(/^\/?#?/, '')
      notifications.load()
      dms.load()
    }
  })

  // Installed apps open outside links in the real browser.
  if (matchMedia('(display-mode: standalone)').matches) {
    // Mark this window as the installed app (the query survives hash
    // navigation) and tell the service worker the app is installed here, so
    // a tapped notification opens the app rather than a browser tab.
    if (!new URLSearchParams(location.search).has('app')) history.replaceState(history.state, '', '/?app' + location.hash)
    navigator.serviceWorker?.ready.then((r) => r.active?.postMessage({ type: 'installed' })).catch(() => {})
    document.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest?.('a[href]') as HTMLAnchorElement | null
      if (a && a.hostname !== location.hostname) { e.preventDefault(); window.open(a.href, '_blank') }
    })
  }

  async function refreshPosts() {
    try {
      await posts.refresh()
    } catch (e) {
      toasts.error(e instanceof Error ? e.message : 'Could not check X')
    }
  }

  function toggleDark() {
    dark = !dark
    setDarkMode(dark)
  }

</script>

<Toast />

{#if !auth.signedIn}
  <Login />
{:else}
  <div class="shell">
    {#if view === 'detail'}
      <TopBar leading="back" {title} onleading={() => router.back('/notifications')} />
    {:else if view === 'post'}
      <TopBar leading="back" {title} onleading={() => router.back('/posts')} />
    {:else if view === 'chat'}
      <TopBar leading="back" {title} onleading={() => router.back('/messages')} />
    {:else if view === 'profile'}
      <TopBar leading="back" {title} onleading={() => router.back('/notifications')} />
    {:else if section}
      <TopBar leading="back" title={SECTIONS[section]} onleading={() => router.back('/settings')} />
    {:else if view === 'posts'}
      <TopBar leading="menu" {title} onleading={() => (menuOpen = true)} trailingLabel="Check X for posts made elsewhere" ontrailing={refreshPosts}>
        {#snippet trailing()}
          <span class:turning={posts.syncing}><Icon name="refresh" /></span>
        {/snippet}
      </TopBar>
    {:else if view === 'write'}
      <TopBar leading="menu" {title} onleading={() => (menuOpen = true)} trailingLabel="Notifications" ontrailing={() => router.go('/notifications')}>
        {#snippet trailing()}
          <span class="bell"><Icon name="notifications" />{#if notifications.unread || dms.unread}<i></i>{/if}</span>
        {/snippet}
      </TopBar>
    <!-- No refresh on Notifications or Messages: a button that might bring
         something new is a slot machine lever. What you see changes only
         when X delivers something. -->
    {:else}
      <TopBar leading="menu" {title} onleading={() => (menuOpen = true)} />
    {/if}

    <main class="body">
      {#if prefs.missingScopes.length && (view === 'notifications' || view === 'detail' || view === 'profile')}
        <p class="grant">notime can now follow people for you. <button onclick={() => auth.signIn()}>Sign in again</button> to allow it.</p>
      {/if}
      {#if view === 'notifications'}
        <Notifications />
      {:else if view === 'detail'}
        {#key detailId}<Detail id={detailId} />{/key}
      {:else if view === 'posts'}
        <Posts />
      {:else if postRoute}
        {#key postRoute.id + postRoute.quote}<Post id={postRoute.id} quote={postRoute.quote} />{/key}
      {:else if view === 'messages'}
        <Messages />
      {:else if chatId}
        {#key chatId}<Chat id={chatId} />{/key}
      {:else if profileId}
        {#key profileId}<Profile id={profileId} />{/key}
      {:else if view === 'settings'}
        <Settings {section} />
      {:else}
        <Write onposted={() => (engaged = true)} />
      {/if}
    </main>

    <InstallBanner when={engaged || view === 'notifications'} text="Install notime to get notifications" bottom="24px" />
  </div>

  <Drawer open={menuOpen} onclose={() => (menuOpen = false)} {entries}>
    {#snippet brand()}
      <span class="brand">notime</span>
    {/snippet}
    {#snippet footer()}
      {#if auth.user}
        <div class="user">
          <Avatar src={auth.user.avatar} name={auth.user.name || auth.user.username} size={32} />
          <span>@{auth.user.username}</span>
        </div>
      {/if}
      <button class="foot-btn" onclick={toggleDark} tabindex={menuOpen ? 0 : -1}>
        <Icon name={dark ? 'light_mode' : 'dark_mode'} size={20} />{dark ? 'Light mode' : 'Dark mode'}
      </button>
      <button class="foot-btn" onclick={() => auth.signOut()} tabindex={menuOpen ? 0 : -1}>
        <Icon name="logout" size={20} />Sign out
      </button>
      <!-- The reload icon is the always-there escape hatch (forget the cached
           app, load it fresh); it lights up when a new version is waiting. -->
      <p class="build">
        <span>Version {__BUILD__}</span>
        <ResetButton tabindex={menuOpen ? 0 : -1} />
      </p>
    {/snippet}
  </Drawer>
{/if}

<style>
  .shell { display: flex; flex-direction: column; height: 100%; position: relative; }
  /* The one scroller. */
  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior-y: contain;
  }
  @media (min-width: 768px) {
    .shell { margin-inline-start: min(78vw, 300px); }
  }
  .brand { font-family: var(--font-write); font-size: 1.5rem; color: var(--accent-deep); }
  :global(.dark) .brand { color: var(--accent-light); }
  .user { display: flex; align-items: center; gap: 10px; font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 8px; }
  .foot-btn { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 44px; font-size: 0.9rem; color: var(--text-primary); }
  .build { display: flex; align-items: center; gap: 6px; font-size: 0.65rem; color: var(--text-secondary); margin-top: 8px; }
  .build span { opacity: 0.6; }

  .bell { position: relative; display: grid; }
  .bell i { position: absolute; top: 0; right: 0; width: 9px; height: 9px; border-radius: 50%; background: var(--mark); border: 2px solid var(--accent-deep); }
  .grant { margin: 10px 18px 0; padding: 10px 14px; border-radius: 12px; background: var(--accent-soft); font-size: 0.85rem; line-height: 1.45; }
  .grant button { color: var(--accent); text-decoration: underline; font-size: inherit; }
  .turning { display: grid; animation: spin 0.8s linear infinite; }
</style>
