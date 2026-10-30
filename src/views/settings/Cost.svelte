<script lang="ts">
  import { date, money, settings as s } from '../../lib/settings.svelte'

  const KIND: Record<string, string> = {
    post_create: 'Posts', post_create_url: 'Posts with a link', post_read: 'Posts looked up', user_read: 'People looked up',
    owned_read: 'Your posts and mentions read', media_metadata: 'Image descriptions', event_post: 'Replies, mentions, quotes delivered',
    event_like: 'Likes delivered', event_follow: 'Follows delivered', event_dm: 'Messages delivered', like: 'Likes', unlike: 'Unlikes',
    dm_read: 'Messages read from X', dm_send: 'Messages sent', like_read: 'Your likes read from X', follow: 'Follows', unfollow: 'Unfollows',
  }
</script>

{#if s.usage}
  {#if s.usage.since}
    <p class="total">{money(s.usage.spent)} <span class="quiet">spent since {date(s.usage.since)}</span></p>
    {#if s.usage.spentMonth !== s.usage.spent}<p class="quiet">{money(s.usage.spentMonth)} of it this month.</p>{/if}
  {/if}
  {#if s.usage.credits}
    <p class="balance" class:low={s.usage.credits.total < s.usage.low}>{money(s.usage.credits.total)} left on X</p>
    <p class="quiet">
      {#if s.usage.credits.free && s.usage.credits.expires}{money(s.usage.credits.free)} of it is free credit that expires on {date(s.usage.credits.expires)}.{/if}
      You get a notification if it drops below {money(s.usage.low)}.
    </p>
  {:else}
    <p class="quiet">X did not report the balance just now.</p>
  {/if}
  {#if s.usage.rows.length}
    <p class="quiet">Where it went this month, by count. X reports only the total, so the split is the app's own tally, about {money(s.usage.total)} at list prices.</p>
    <ul class="checks">
      {#each s.usage.rows as r}<li><span>{KIND[r.kind] ?? r.kind}</span><span>{r.n}</span></li>{/each}
    </ul>
  {/if}
{:else}
  <span class="spinner"></span>
{/if}

<style>
  .total { font-family: var(--font-write); font-size: 1.6rem; font-variant-numeric: tabular-nums; }
  .total .quiet { font-family: var(--font-body); font-size: 0.88rem; }
  .balance { font-size: 0.95rem; font-variant-numeric: tabular-nums; margin-bottom: 4px; }
  .balance.low { color: var(--danger); }
</style>
