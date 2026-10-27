<script lang="ts">
  // Follow or unfollow, wherever a person shows up. Learns the current state
  // once (from the server's cache when it has it).
  import { auth } from '../lib/auth.svelte'
  import { explain } from '../lib/prefs.svelte'
  import { follows } from '../lib/people.svelte'
  import { toasts } from '$shared/lib/toast.svelte'

  let { id }: { id: string } = $props()
  const s = $derived(follows.state[id])
  let busy = $state(false)

  $effect(() => { if (id && id !== auth.user?.id) follows.learn(id) })

  async function click(e: MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    busy = true
    try {
      await follows.toggle(id)
    } catch (err) {
      const why = explain(err, 'X did not take that')
      if (why.includes('Sign in')) toasts.error('Following needs a new permission from X. Sign in again from the menu to allow it.')
      else toasts.error(why)
    } finally {
      busy = false
    }
  }
</script>

{#if id !== auth.user?.id && s && s.on !== null}
  <button class="follow" class:on={s.on} onclick={click} disabled={busy} aria-pressed={!!s.on}>
    {s.on ? (s.pending ? 'Requested' : 'Following') : 'Follow'}
  </button>
{/if}

<style>
  .follow {
    flex: none; min-height: 32px; padding: 0 14px; border-radius: 16px; font-size: 0.82rem; font-weight: 500;
    background: var(--accent); color: #fff; border: 1px solid var(--accent);
  }
  :global(.dark) .follow { color: #10201c; }
  .follow.on, :global(.dark) .follow.on { background: transparent; color: var(--text-primary); border-color: var(--border); font-weight: 400; }
  .follow:disabled { opacity: 0.6; }
</style>
