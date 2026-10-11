<script lang="ts">
  // The gate. One button, because there is one way in.
  import { auth } from '../lib/auth.svelte'
  let leaving = $state(false)
</script>

<div class="login">
  <div class="card">
    <img src="/icons/icon-192.png" alt="" width="76" height="76" />
    <h1>notime</h1>
    <p>Write posts. Answer the people who answer you. Skip the timeline.</p>
    <button onclick={() => { leaving = true; auth.signIn() }} disabled={leaving}>
      {#if leaving}<span class="spinner"></span>{:else}
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
        Sign in with X
      {/if}
    </button>
  </div>
</div>

<style>
  .login { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; background: var(--accent-deep); padding: 24px; }
  .card { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; max-width: 320px; width: 100%; color: #fff; }
  img { border-radius: 18px; margin-bottom: 10px; }
  h1 { font-family: var(--font-write); font-size: 2.2rem; font-weight: 400; color: #fff; }
  p { font-size: 1rem; line-height: 1.5; color: #b9d6ce; margin-bottom: 22px; }
  button {
    display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; min-height: 50px;
    border-radius: 25px; background: #fff; color: #14201c; font-size: 0.98rem; font-weight: 500;
  }
  button:hover { box-shadow: 0 2px 12px rgba(0, 0, 0, 0.25); }
  .spinner { border-color: #dbe2db; border-top-color: #1f4a41; }
</style>
