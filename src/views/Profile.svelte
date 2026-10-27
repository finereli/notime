<script lang="ts">
  // Someone's profile: who they are and what they posted lately. A cent to
  // look up the first time each day, so it is only fetched when opened.
  import Avatar from '../components/Avatar.svelte'
  import FollowButton from '../components/FollowButton.svelte'
  import Icon from '../components/Icon.svelte'
  import Rich from '../components/Rich.svelte'
  import { apiJson } from '../lib/api'
  import { displayName } from '../lib/collapse'
  import { follows, type Person } from '../lib/people.svelte'
  import type { Extra } from '../lib/rich'
  import { ago } from '../lib/time'

  let { id }: { id: string } = $props()

  interface Post { id: string; text: string; created_at: string; extra?: Extra | null }
  let user = $state<Person | null>(null)
  let posts = $state<Post[]>([])
  let me = $state(false)
  let missing = $state(false)

  $effect(() => {
    apiJson<{ user: Person; posts: Post[]; me: boolean }>(`/api/users/${id}`)
      .then((r) => {
        user = r.user
        posts = r.posts
        me = r.me
        if (!r.me && !follows.state[id]?.pending) follows.set(id, r.user.i_follow)
      })
      .catch(() => (missing = true))
  })

  const count = (n: number | null) => (n == null ? '' : n >= 10000 ? `${Math.round(n / 1000)}K` : n.toLocaleString())
  const host = (u: string) => u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')
</script>

<div class="page">
  {#if user}
    <header>
      <Avatar src={user.avatar?.replace('_normal', '_200x200')} name={displayName(user)} size={72} />
      <div class="who">
        <h2>{displayName(user)}</h2>
        {#if user.username}<p class="handle">@{user.username}{#if user.follows_me}<span class="tag">Follows you</span>{/if}</p>{/if}
      </div>
    </header>

    {#if user.description}<p class="bio" dir="auto">{user.description}</p>{/if}
    {#if user.location || user.url}
      <p class="meta">
        {#if user.location}<span><Icon name="location_on" size={14} />{user.location}</span>{/if}
        {#if user.url}<a href={user.url} target="_blank" rel="noopener"><Icon name="link" size={14} />{host(user.url)}</a>{/if}
      </p>
    {/if}
    {#if user.followers != null}
      <p class="meta"><span><strong>{count(user.following)}</strong> following</span><span><strong>{count(user.followers)}</strong> followers</span></p>
    {/if}

    {#if !me}
      <div class="actions">
        <FollowButton {id} />
        <a class="plain" href={`#/m/${id}`}>Message</a>
        {#if user.username}<a class="plain" href={`https://x.com/${user.username}`} target="_blank" rel="noopener">Open on X</a>{/if}
      </div>
    {/if}

    <h3>Recent posts</h3>
    {#each posts as p (p.id)}
      <article>
        <p class="when"><time>{ago(p.created_at)}</time></p>
        <div class="text" dir="auto"><Rich text={p.text} extra={p.extra} limit={280} /></div>
        {#if user.username}<a class="out" href={`https://x.com/${user.username}/status/${p.id}`} target="_blank" rel="noopener">Open on X <Icon name="open_in_new" size={13} /></a>{/if}
      </article>
    {:else}
      <p class="quiet">No recent posts.</p>
    {/each}
  {:else if missing}
    <p class="quiet">Could not find this account. <a href="#/notifications">Back</a></p>
  {:else}
    <div class="wait"><span class="spinner"></span></div>
  {/if}
</div>

<style>
  header { display: flex; align-items: center; gap: 14px; }
  .who { min-width: 0; }
  h2 { font-size: 1.25rem; font-weight: 500; overflow-wrap: anywhere; }
  .handle { font-size: 0.88rem; color: var(--text-secondary); display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .tag { font-size: 0.72rem; padding: 2px 8px; border-radius: 8px; background: var(--bg-hover); }
  .bio { margin-top: 14px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
  .meta { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 0.85rem; color: var(--text-secondary); }
  .meta span, .meta a { display: inline-flex; align-items: center; gap: 4px; }
  .meta a { color: var(--accent); text-decoration: none; overflow-wrap: anywhere; }
  .meta strong { color: var(--text-primary); font-weight: 500; }
  .actions { margin-top: 16px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .plain { min-height: 32px; padding: 0 14px; border-radius: 16px; border: 1px solid var(--border); font-size: 0.82rem; color: var(--text-primary); text-decoration: none; display: inline-flex; align-items: center; }
  h3 { margin: 26px 0 4px; font-size: 0.85rem; font-weight: 500; color: var(--text-secondary); }
  article { padding: 12px 0; border-bottom: 1px solid var(--border); }
  .when { font-size: 0.75rem; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
  .text { margin-top: 4px; line-height: 1.45; overflow-wrap: anywhere; }
  .out { display: inline-flex; align-items: center; gap: 4px; margin-top: 6px; font-size: 0.75rem; color: var(--text-secondary); text-decoration: none; }
  .wait { display: grid; place-items: center; padding-top: 20vh; }
</style>
