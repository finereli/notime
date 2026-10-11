<script lang="ts">
  // One of your own posts, with a box to add to it: a follow-up (a reply to
  // yourself, which X shows as a thread) or a quote.
  import Composer from '../components/Composer.svelte'
  import Icon from '../components/Icon.svelte'
  import { apiJson } from '../lib/api'
  import { auth } from '../lib/auth.svelte'
  import { drafts } from '../lib/drafts.svelte'
  import { isEmpty, replyId } from '../lib/drafts-core'
  import { posts, postTime, type OwnPost } from '../lib/posts.svelte'
  import { router } from '../lib/router.svelte'
  import { ago } from '../lib/time'
  import type { Sent } from '../lib/send.svelte'

  let { id, quote }: { id: string; quote: boolean } = $props()

  // The parent keys this component on id and mode, so reading them once is right.
  // svelte-ignore state_referenced_locally
  const key = (quote ? 'quote:' : 'own:') + id
  // svelte-ignore state_referenced_locally
  let post = $state<OwnPost | null>(posts.items.find((p) => p.id === id) ?? null)
  let missing = $state(false)
  let sent = $state<Sent | null>(null)

  // svelte-ignore state_referenced_locally
  if (!post) apiJson<OwnPost>(`/api/posts/${id}`).then((p) => (post = p)).catch(() => (missing = true))

  drafts.reply(key)
  const draft = $derived(drafts.state.drafts[replyId(key)])
  const url = $derived(`https://x.com/${auth.user?.username ?? 'i'}/status/${id}`)

  function done(result: Sent) {
    sent = result
    drafts.remove(replyId(key))
    posts.load()
  }

  // X sells real quote posts to Enterprise accounts only. A link to the post
  // at the end of the text does the same thing on screen, at the link price.
  // That is an ordinary post, so it moves to the main writing screen.
  // The Write screen holds one post. If it has one in progress, ask first.
  let replacing = $state(false)
  function quoteWithLink() {
    const from = draft
    const to = drafts.current
    if (!isEmpty(to) && !replacing) { replacing = true; return }
    for (const image of to.posts.flatMap((p) => p.images)) drafts.dropImage(image.id)
    to.poll = null
    to.posts = from.posts.map((p, i) => ({ ...p, text: i === 0 ? `${p.text.trim()} ${url}`.trim() : p.text }))
    drafts.touch(to)
    // The images now belong to the new draft; drop only the old shell.
    from.posts = [{ text: '', images: [] }]
    drafts.remove(replyId(key))
    router.go('/')
  }
</script>

<div class="page">
  {#if post}
    <article>
      <p class="text" dir="auto">{post.text}</p>
      <p class="meta">
        <time>{ago(postTime(post))}</time>
        <a href={url} target="_blank" rel="noopener">Open on X <Icon name="open_in_new" size={14} /></a>
      </p>
    </article>

    {#if sent}
      <p class="sent"><Icon name="check_circle" size={20} /> {quote ? 'Quoted.' : 'Posted.'} <a href={sent.url} target="_blank" rel="noopener">Open on X</a></p>
      <p><button class="link" onclick={() => router.go(`/p/${sent!.ids[sent!.ids.length - 1]}`)}>Follow up on that one</button></p>
    {:else if draft}
      <div class="tabs" role="tablist">
        <a role="tab" aria-selected={!quote} class:on={!quote} href={`#/p/${id}`}>Follow up</a>
        <a role="tab" aria-selected={quote} class:on={quote} href={`#/p/${id}/quote`}>Quote</a>
      </div>
      <div class="box">
        <Composer {draft} reply={{ postId: id, quote }} placeholder={quote ? 'Say something about it' : 'And another thing'} onsent={done} />
      </div>
      {#if quote}
        <p class="quiet note">
          X may refuse quotes from apps like this one. If it does,
          <button class="link" onclick={quoteWithLink}>quote with a link instead</button>, which looks the same and costs $0.20.
        </p>
        {#if replacing}
          <p class="quiet note" role="alert">
            The Write screen has a post you haven't sent. <button class="link" onclick={quoteWithLink}>Replace it</button> or <button class="link" onclick={() => (replacing = false)}>keep it</button>.
          </p>
        {/if}
      {/if}
    {/if}
  {:else if missing}
    <p class="quiet">That post is not one of yours, or it is gone. <a href="#/posts">Back to your posts</a></p>
  {:else}
    <div class="wait"><span class="spinner"></span></div>
  {/if}
</div>

<style>
  article { padding-inline-start: 12px; border-inline-start: 2px solid var(--accent-light); }
  .text { font-size: 1.05rem; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
  .meta { display: flex; align-items: center; gap: 16px; margin-top: 6px; font-size: 0.8rem; color: var(--text-secondary); }
  .meta a { display: inline-flex; align-items: center; gap: 5px; min-height: 36px; color: inherit; text-decoration: none; }
  time { font-variant-numeric: tabular-nums; }

  .tabs { display: flex; gap: 4px; margin-top: 18px; }
  .tabs a { min-height: 40px; padding: 0 16px; display: grid; place-items: center; border-radius: 20px; font-size: 0.88rem; text-decoration: none; color: var(--text-secondary); }
  .tabs a.on { background: var(--accent-soft); color: var(--accent-deep); font-weight: 500; }
  :global(.dark) .tabs a.on { color: var(--accent-light); }

  .box { margin-top: 10px; padding: 14px 16px 8px; border: 1px solid var(--border); border-radius: 16px; background: var(--bg-raised); }
  .note { margin-top: 12px; }
  .sent { display: flex; align-items: center; gap: 8px; margin-top: 22px; color: var(--accent); font-size: 0.95rem; }
  .link { color: var(--accent); text-decoration: underline; font-size: inherit; min-height: 36px; }
  .wait { display: grid; place-items: center; padding-top: 20vh; }
</style>
