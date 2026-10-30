<script lang="ts">
  import { settings as s } from '../../lib/settings.svelte'
  let pin = $state('')

  async function unlock(e: SubmitEvent) {
    e.preventDefault()
    if (await s.unlockChat(pin)) pin = ''
  }
</script>

{#if s.chat?.unlocked}
  <p class="state" role="status"><span class="dot ok"></span>Unlocked. Your messages from X Chat show up in Messages.</p>
  <p class="quiet">The server keeps your chat keys sealed, so it can read new messages as they arrive and send your answers. Locking deletes them; you would need the PIN again.</p>
  <div class="row"><button class="btn plain" onclick={() => s.lockChat()} disabled={s.chatBusy}>Lock</button></div>
{:else if s.chat}
  <p class="quiet">X keeps direct messages encrypted. To read and answer them here, enter the PIN you set for Chat in the X app. The PIN is used once to fetch your keys from X's backup and is not kept. A wrong PIN uses up one of a few tries.</p>
  <form class="row" onsubmit={unlock}>
    <input class="pin" type="password" inputmode="numeric" autocomplete="off" aria-label="X Chat PIN" placeholder="PIN" bind:value={pin} />
    <button class="btn" disabled={s.chatBusy || !pin.trim()}>{s.chatBusy ? 'Unlocking' : 'Unlock'}</button>
  </form>
  {#if s.chatError}<p class="quiet bad-text" role="alert">{s.chatError}</p>{/if}
{:else}
  <span class="spinner"></span>
{/if}

<style>
  .pin { flex: 1; min-width: 0; max-width: 12rem; min-height: 44px; padding: 0 12px; border: 1px solid var(--border); border-radius: 12px; background: var(--bg-raised); font-size: 1rem; letter-spacing: 0.2em; }
</style>
