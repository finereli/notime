# notime

A way to use X without looking at it. You can write posts, see who answered,
and answer them back. There is no timeline, no search and no profiles, because
those are the parts that eat the afternoon.

It is a single-user app. It signs in with one X account (`OWNER_USERNAME` in
`wrangler.jsonc`) and refuses every other, since every call is billed to that
account's API credit.

## What it does

- Posts: text, threads, up to four images each with a description, polls, and
  who can reply. Long posts are allowed if the account has Premium.
- Drafts: everything you type is saved on the device as you type it, images
  included, and stays until it is posted. Start a new post and the old one
  waits under Drafts.
- Notifications: replies, mentions and quotes, each with a reply box. Likes,
  reposts and follows show up as quiet one-line rows.
- Push: replies, mentions and quotes reach your phone. Likes and the rest do
  not unless you ask for them in Settings.

Left out on purpose: video, GIFs, quote posts (X sells those to Enterprise
only), scheduling, DMs.

## How it is built

One Cloudflare Worker serves the built Svelte app and the API, with D1 behind
it. The shell follows the `pwa` skill and its kit (`shared/` holds the kit
files, headers intact).

    src/        the app: views, the composer, drafts, the notification list
    shared/     pwa-kit files: shell, update flow, router, toast, theme
    worker/     the API: X login, posting, the webhook, web push
    migrations/ the D1 schema
    test/       unit tests, plus two browser walkthroughs

Notifications are pushed to us by X rather than polled. The X Activity API
delivers each reply, mention, quote, repost, like and follow to
`/api/webhook/x`, signed with the app's OAuth 2.0 client secret. The Worker
checks the signature, stores the event, and sends a web push. The "check"
button on the notifications screen reads the mentions timeline as a safety
net for anything the webhook missed.

## Running it locally

    npm install
    node scripts/vapid.mjs        # once: makes the push keys, appends to .env
    node scripts/dev-vars.mjs     # writes .dev.vars from .env
    npx wrangler d1 migrations apply notime-db --local
    npm run dev                   # builds, then serves http://127.0.0.1:8787

With `DEV_AUTH=allow` in `.dev.vars` (the default from the script) the Worker
talks to a stand-in for X: signing in is instant, posting goes nowhere, and a
post containing `#fail` is refused so you can see what refusal looks like.
The bypass needs both that variable and a local hostname.

To sign in with the real X locally, run `node scripts/dev-vars.mjs --real`
and use `http://127.0.0.1:8787` exactly. That address is registered as a
callback with X; `localhost` is not.

    npm test                      # unit tests
    node test/e2e.mjs             # the whole app in a headless phone
    node test/updates.mjs         # the service worker update flow

Both browser scripts need `npm run dev` running in another terminal.

## Deploying

    npx wrangler d1 create notime-db          # put the id in wrangler.jsonc
    npx wrangler d1 migrations apply notime-db --remote
    node scripts/secrets.mjs                  # pushes secrets from .env
    npm run deploy

Then open the site and sign in. Signing in registers the webhook with X and
creates the six subscriptions. Settings shows whether each one took, with X's
own error text if it did not, and a button to try again.

Secrets the Worker expects: `X_CLIENT_ID`, `X_CLIENT_SECRET`,
`X_BEARER_TOKEN`, `X_CONSUMER_SECRET`, `VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. They live in `.env`, which is not in
git. Do not regenerate the VAPID keys once phones have subscribed: every
existing subscription would silently stop working.

## What X charges

Pay per use, as of October 2026: about a cent and a half per post, twenty
cents for a post with a link in it, a tenth of a cent per mention read back,
half a cent per event delivered. The app caches every user and post it looks
up, never polls, and shows a running estimate in Settings.
