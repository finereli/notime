<!-- pwa-kit: icons/ui/Icon.svelte v1 -->
<script lang="ts">
  // Inline SVG icon. Draws a Material Symbols glyph from src/lib/icons.ts with
  // no font to download, so it renders instantly. `size` is in px; colour comes
  // from the surrounding `color` (fill: currentColor), same as the old font.
  import { icons } from '../lib/icons'

  let { name, size = 24 }: { name: string; size?: number } = $props()
  const d = $derived(icons[name])

  // Filled glyphs the static font cannot give us, in the font's own y-down
  // web coordinates.
  const FILLED: Record<string, string> = {
    favorite_fill: 'm480-147-58-52q-101-91-167-157T150-474.5q-39-52.5-54.5-96T80-659q0-94 63-157.5T300-880q52 0 99 22t81 62q34-40 81-62t99-22q94 0 157 63.5T880-659q0 46-15.5 89.5T810-474.5Q771-422 705-356T538-199l-58 52Z',
  }
</script>

{#if FILLED[name]}
  <svg class="icon" width={size} height={size} viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d={FILLED[name]} /></svg>
{:else if d}
  <svg
    class="icon"
    width={size}
    height={size}
    viewBox="0 0 960 960"
    fill="currentColor"
    aria-hidden="true"
  >
    <path transform="translate(0 960) scale(1 -1)" {d} />
  </svg>
{/if}

<style>
  .icon {
    display: inline-block;
    vertical-align: middle;
    flex: none;
  }
</style>
