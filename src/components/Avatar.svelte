<script lang="ts">
  // A face when X gave us one, an initial when it did not.
  let { src = null, name = '', size = 40 }: { src?: string | null; name?: string; size?: number } = $props()
  let broken = $state(false)
  const initial = $derived((name.replace(/^@/, '')[0] || '?').toUpperCase())
</script>

{#if src && !broken}
  <img class="avatar" {src} alt="" width={size} height={size} onerror={() => (broken = true)} referrerpolicy="no-referrer" />
{:else}
  <span class="avatar blank" style:width="{size}px" style:height="{size}px" style:font-size="{size * 0.42}px">{initial}</span>
{/if}

<style>
  .avatar { border-radius: 50%; flex: none; display: block; object-fit: cover; background: var(--bg-hover); }
  .blank { display: grid; place-items: center; background: var(--accent-soft); color: var(--accent-deep); font-weight: 500; }
  :global(.dark) .blank { color: var(--accent-light); }
</style>
