<script lang="ts">
  // The writing surface, used for new posts and for replies. It edits a draft
  // in place and tells the drafts store on every change, so there is no save
  // button and nothing to lose.
  import Icon from './Icon.svelte'
  import { drafts } from '../lib/drafts.svelte'
  import { postIsEmpty, type Draft, type DraftImage } from '../lib/drafts-core'
  import { sendDraft, sending, type ReplyTarget, type Sent } from '../lib/send.svelte'
  import { LIMIT, LONG_LIMIT, hasUrl, weightedLength } from '../lib/text'
  import { prefs } from '../lib/prefs.svelte'
  import { isImageFile, resizeImage } from '$shared/lib/image-resize'

  let { draft, reply = null, placeholder = 'What do you want to say?', onsent }: {
    draft: Draft; reply?: ReplyTarget | null; placeholder?: string; onsent: (sent: Sent) => void
  } = $props()

  let active = $state(0)
  let progress = $state('')
  let error = $state('')
  let urls = $state<Record<string, string>>({})
  let describing = $state<string | null>(null)
  let picker = $state<HTMLInputElement>()

  const thread = $derived(draft.posts.length > 1)
  const resuming = $derived(draft.posts.some((p) => p.sentId))
  const anyImages = $derived(draft.posts.some((p) => p.images.length > 0))
  const linked = $derived(draft.posts.some((p) => !p.sentId && hasUrl(p.text)))
  const pollReady = $derived(!draft.poll || (draft.poll.options.filter((o) => o.trim()).length >= 2 && !!draft.posts[0].text.trim()))
  const limit = $derived(prefs.longPosts ? LONG_LIMIT : LIMIT)
  const tooLong = $derived(draft.posts.some((p) => !p.sentId && weightedLength(p.text) > limit))
  const canSend = $derived(!sending.active && pollReady && !tooLong && draft.posts.some((p) => !p.sentId && !postIsEmpty(p)))
  const sendLabel = $derived(resuming ? 'Post the rest' : thread ? 'Post all' : reply?.quote ? 'Quote' : reply?.notificationId ? 'Reply' : 'Post')
  // Answering someone is one post. Following up on yourself can run long.
  const single = $derived(!!reply?.notificationId)

  const DURATIONS = [
    { minutes: 60, label: '1 hour' },
    { minutes: 360, label: '6 hours' },
    { minutes: 1440, label: '1 day' },
    { minutes: 4320, label: '3 days' },
    { minutes: 10080, label: '7 days' },
  ]
  const AUDIENCES = [
    { value: 'everyone', label: 'Everyone can reply' },
    { value: 'following', label: 'People you follow' },
    { value: 'mentionedUsers', label: 'Only people you mention' },
    { value: 'verified', label: 'Verified accounts' },
    { value: 'subscribers', label: 'Your subscribers' },
  ]

  $effect(() => {
    for (const post of draft.posts) {
      for (const image of post.images) {
        if (urls[image.id]) continue
        drafts.imageUrl(image.id).then((url) => { if (url) urls[image.id] = url })
      }
    }
  })

  function changed() {
    error = ''
    drafts.touch(draft)
  }

  function grow(node: HTMLTextAreaElement) {
    const fit = () => {
      node.style.height = 'auto'
      node.style.height = node.scrollHeight + 'px'
    }
    fit()
    node.addEventListener('input', fit)
    return { destroy: () => node.removeEventListener('input', fit) }
  }

  async function addFiles(files: Iterable<File>, index = active) {
    const post = draft.posts[index] ?? draft.posts[0]
    if (post.sentId) return
    const images = [...files].filter(isImageFile)
    if (!images.length) return
    if (draft.poll) { error = 'A post can have a poll or images, not both.'; return }
    for (const file of images) {
      if (post.images.length >= 4) { error = 'Four images is the most one post can hold.'; break }
      try {
        const { blob } = await resizeImage(file)
        post.images.push(await drafts.addImage(blob))
        changed()
      } catch {
        error = `Could not read ${file.name || 'that image'}.`
      }
    }
  }

  function removeImage(index: number, image: DraftImage) {
    const post = draft.posts[index]
    post.images = post.images.filter((i) => i.id !== image.id)
    drafts.dropImage(image.id)
    if (describing === image.id) describing = null
    changed()
  }

  function addPost() {
    draft.posts.push({ text: '', images: [] })
    active = draft.posts.length - 1
    changed()
  }

  function removePost(index: number) {
    for (const image of draft.posts[index].images) drafts.dropImage(image.id)
    draft.posts.splice(index, 1)
    active = Math.min(active, draft.posts.length - 1)
    changed()
  }

  function togglePoll() {
    if (draft.poll) draft.poll = null
    else if (anyImages) { error = 'A post can have a poll or images, not both.'; return }
    else draft.poll = { options: ['', ''], minutes: 1440 }
    changed()
  }

  async function send() {
    if (!canSend) return
    error = ''
    try {
      const sent = await sendDraft(draft, reply, (label) => (progress = label))
      onsent(sent)
    } catch (e) {
      const done = draft.posts.filter((p) => p.sentId).length
      const message = e instanceof Error ? e.message : 'Posting failed'
      error = done > 0 && done < draft.posts.length ? `${message} ${done} of ${draft.posts.length} went out. The rest is saved here.` : message
    } finally {
      progress = ''
    }
  }

  function keydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() }
  }
</script>

<div
  class="composer"
  role="group"
  aria-label={reply ? 'Reply' : 'New post'}
  ondragover={(e) => e.preventDefault()}
  ondrop={(e) => { e.preventDefault(); if (e.dataTransfer?.files.length) addFiles(e.dataTransfer.files) }}
>
  {#each draft.posts as post, i (i)}
    {@const count = weightedLength(post.text)}
    <section class="post" class:sent={!!post.sentId} class:continued={i > 0}>
      {#if thread}
        <p class="step">
          <span>{i + 1} of {draft.posts.length}{post.sentId ? ', posted' : ''}</span>
          {#if !post.sentId && !sending.active}
            <button class="link" onclick={() => removePost(i)}>Remove</button>
          {/if}
        </p>
      {/if}

      <textarea
        use:grow
        bind:value={post.text}
        oninput={changed}
        onfocus={() => (active = i)}
        onkeydown={keydown}
        onpaste={(e) => { if (e.clipboardData?.files.length) { e.preventDefault(); addFiles(e.clipboardData.files, i) } }}
        placeholder={i === 0 ? placeholder : 'And then?'}
        readonly={!!post.sentId || sending.active}
        dir="auto"
        rows={i === 0 && !reply ? 4 : 2}
        aria-label={thread ? `Post ${i + 1}` : 'Post text'}
      ></textarea>

      {#if post.images.length}
        <ul class="images" class:single={post.images.length === 1}>
          {#each post.images as image (image.id)}
            <li>
              {#if urls[image.id]}<img src={urls[image.id]} alt={image.alt} />{/if}
              {#if !post.sentId}
                <button class="chip remove" onclick={() => removeImage(i, image)} aria-label="Remove image"><Icon name="close" size={16} /></button>
                <button class="chip alt" class:has={!!image.alt.trim()} onclick={() => (describing = describing === image.id ? null : image.id)}>
                  {image.alt.trim() ? 'Described' : 'Describe'}
                </button>
              {/if}
            </li>
          {/each}
        </ul>
        {#each post.images as image (image.id)}
          {#if describing === image.id}
            <!-- svelte-ignore a11y_autofocus -->
            <textarea class="alt-text" bind:value={image.alt} oninput={changed} maxlength="1000" rows="2" autofocus
              placeholder="Describe this image for people who can't see it"></textarea>
          {/if}
        {/each}
      {/if}

      {#if count > 0 && !post.sentId}
        <p class="count" class:long={count > LIMIT && count <= limit} class:over={count > limit}>
          {#if count > limit}{count - limit} over the limit of {limit.toLocaleString()}
          {:else if count > LIMIT}{count.toLocaleString()}, a long post
          {:else}{count} of {LIMIT}{/if}
        </p>
      {/if}
    </section>
  {/each}

  {#if draft.poll}
    <section class="poll">
      {#each draft.poll.options as _, k}
        <div class="option">
          <input bind:value={draft.poll.options[k]} oninput={changed} maxlength="25" placeholder={`Choice ${k + 1}`} aria-label={`Choice ${k + 1}`} />
          {#if draft.poll.options.length > 2}
            <button class="icon" onclick={() => { draft.poll!.options.splice(k, 1); changed() }} aria-label="Remove choice"><Icon name="close" size={16} /></button>
          {/if}
        </div>
      {/each}
      <div class="poll-foot">
        {#if draft.poll.options.length < 4}
          <button class="link" onclick={() => { draft.poll!.options.push(''); changed() }}>Add a choice</button>
        {/if}
        <label>Open for
          <select bind:value={draft.poll.minutes} onchange={changed}>
            {#each DURATIONS as d}<option value={d.minutes}>{d.label}</option>{/each}
          </select>
        </label>
      </div>
    </section>
  {/if}

  {#if linked}
    <p class="note">Posts with a link cost $0.20 to send.</p>
  {/if}
  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}

  <div class="bar">
    <input bind:this={picker} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden
      onchange={(e) => { addFiles(e.currentTarget.files ?? []); e.currentTarget.value = '' }} />
    <button class="icon" onclick={() => picker?.click()} disabled={sending.active} aria-label="Add images" title="Add images"><Icon name="add_photo_alternate" /></button>
    {#if reply && !single}
      <button class="icon" onclick={addPost} disabled={sending.active} aria-label="Add another post" title="Add another post"><Icon name="add" /></button>
    {/if}
    {#if !reply}
      <button class="icon" class:on={!!draft.poll} onclick={togglePoll} disabled={sending.active} aria-label={draft.poll ? 'Remove poll' : 'Add a poll'} title={draft.poll ? 'Remove poll' : 'Add a poll'}><Icon name="ballot" /></button>
      <button class="icon" onclick={addPost} disabled={sending.active} aria-label="Add another post" title="Add another post"><Icon name="add" /></button>
      <label class="audience" title="Who can reply">
        <Icon name="public" size={20} />
        <select bind:value={draft.replySettings} onchange={changed} disabled={sending.active} aria-label="Who can reply">
          {#each AUDIENCES as a}<option value={a.value}>{a.label}</option>{/each}
        </select>
      </label>
    {/if}
    <span class="grow" aria-live="polite">
      {#if progress}<span class="spinner"></span>{progress}{/if}
    </span>
    <button class="send" onclick={send} disabled={!canSend}>{sendLabel}</button>
  </div>
</div>

<style>
  .composer { display: flex; flex-direction: column; gap: 4px; }

  .post { display: flex; flex-direction: column; }
  .post.continued { border-top: 1px solid var(--border); margin-top: 10px; padding-top: 12px; }
  .post.sent { opacity: 0.55; }

  .step { display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem; color: var(--text-secondary); min-height: 28px; font-variant-numeric: tabular-nums; }

  textarea {
    width: 100%;
    border: none;
    outline: none;
    background: transparent;
    resize: none;
    overflow: hidden;
    font-family: var(--font-write);
    font-size: 1.22rem;
    line-height: 1.5;
    white-space: pre-wrap;
    padding: 4px 0;
  }
  textarea::placeholder { color: var(--text-secondary); opacity: 0.7; }
  textarea:focus-visible { outline: none; }

  .images { list-style: none; display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin: 8px 0 4px; }
  .images.single { grid-template-columns: 1fr; }
  .images li { position: relative; aspect-ratio: 4 / 3; border-radius: 14px; overflow: hidden; background: var(--bg-hover); }
  .images.single li { aspect-ratio: auto; max-height: 340px; min-height: 120px; }
  .images img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .images.single img { max-height: 340px; }

  .chip {
    position: absolute;
    min-height: 32px;
    padding: 0 10px;
    border-radius: 16px;
    background: rgba(20, 28, 25, 0.72);
    color: #fff;
    font-size: 0.75rem;
    display: grid;
    place-items: center;
  }
  /* The visible chip is small; the tap area around it is not. */
  .chip::after { content: ''; position: absolute; inset: -6px; }
  .chip.remove { top: 8px; right: 8px; width: 32px; padding: 0; }
  .chip.alt { left: 8px; bottom: 8px; }
  .chip.alt.has { background: var(--accent-deep); }

  .alt-text {
    font-family: var(--font-body);
    font-size: 0.9rem;
    line-height: 1.4;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--bg-raised);
    overflow: auto;
  }
  .alt-text:focus { border-color: var(--accent); }

  .count { align-self: flex-end; font-size: 0.75rem; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
  .count.long { color: var(--warn); }
  .count.over { color: var(--danger); }

  .poll { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; padding: 12px; border: 1px solid var(--border); border-radius: 14px; background: var(--bg-raised); }
  .option { display: flex; gap: 4px; align-items: center; }
  .option input { flex: 1; min-width: 0; height: 44px; padding: 0 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg-surface); font-size: 0.95rem; }
  .option input:focus { border-color: var(--accent); outline: none; }
  .poll-foot { display: flex; justify-content: space-between; align-items: center; gap: 12px; font-size: 0.85rem; color: var(--text-secondary); min-height: 44px; }
  .poll-foot label { margin-inline-start: auto; }
  select { background: transparent; border: none; color: var(--text-primary); font-size: 0.85rem; min-height: 44px; max-width: 100%; }

  .note, .error { font-size: 0.82rem; line-height: 1.4; margin-top: 8px; }
  .note { color: var(--text-secondary); }
  .error { color: var(--danger); }

  .bar { display: flex; align-items: center; gap: 2px; margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--border); margin-inline-start: -10px; }
  .icon { width: 44px; height: 44px; flex: none; display: grid; place-items: center; border-radius: 50%; color: var(--accent); transition: background 0.15s; }
  .icon:hover { background: var(--bg-hover); }
  .icon.on { background: var(--accent-soft); }
  .icon:disabled { opacity: 0.4; }

  /* The select is the control; it is stretched invisibly over the globe so the
     bar stays a row of icons and the phone still shows its native picker. */
  .audience { position: relative; width: 44px; height: 44px; flex: none; display: grid; place-items: center; color: var(--accent); border-radius: 50%; }
  .audience:hover { background: var(--bg-hover); }
  .audience select { position: absolute; inset: 0; width: 100%; opacity: 0; cursor: pointer; }

  .grow { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 0 8px; font-size: 0.8rem; color: var(--text-secondary); white-space: nowrap; overflow: hidden; }
  .link { color: var(--accent); font-size: 0.82rem; min-height: 28px; padding: 0 2px; }

  .send {
    flex: none;
    min-height: 44px;
    padding: 0 22px;
    border-radius: 22px;
    background: var(--accent);
    color: #fff;
    font-weight: 500;
    font-size: 0.95rem;
    transition: filter 0.15s, transform 0.12s;
  }
  :global(.dark) .send { color: #10201c; }
  .send:hover { filter: brightness(0.93); }
  .send:active { transform: scale(0.97); }
  .send:disabled { opacity: 0.4; }
</style>
