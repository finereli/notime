<script lang="ts">
  import { settings as s } from '../../lib/settings.svelte'
</script>

{#if s.push === 'needs-install'}
  <p class="quiet">On an iPhone, notifications only work once the app is on your home screen. In Safari, tap Share, then "Add to Home Screen", open notime from there, and come back to this page.</p>
{:else if s.push === 'unsupported'}
  <p class="quiet">This browser cannot receive push notifications.</p>
{:else if s.push}
  <p class="quiet">
    {s.push === 'on' ? 'This device gets a notification when someone replies to you, mentions you, quotes you or sends you a message.' : 'Get a notification here when someone replies to you, mentions you, quotes you or sends you a message.'}
  </p>
  <div class="row">
    <button class="btn" onclick={() => s.togglePush()} disabled={s.pushBusy || s.push === 'denied'}>{s.push === 'on' ? 'Turn off on this device' : 'Turn on notifications'}</button>
    {#if s.push === 'on'}<button class="btn plain" onclick={() => s.sendTest()} disabled={s.pushBusy}>Send a test</button>{/if}
  </div>
  {#if s.push === 'denied' && !s.pushNote}<p class="quiet">Notifications are blocked for this app in your device settings.</p>{/if}
{/if}
{#if s.pushNote}<p class="quiet" role="status">{s.pushNote}</p>{/if}
