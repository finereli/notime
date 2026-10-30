# notime

A way to use X without looking at it. You can write posts, see who answered,
answer them back, and keep up with direct messages. There is no timeline and
no search, because those are the parts that eat the afternoon. Profiles are
there only when you tap someone, never as something to browse.

There is no refresh button either, and that is deliberate. A button that
might bring something new is a slot machine lever: you pull it to see if
anything came, and pulling becomes the habit the app is meant to break. What
you see changes only when X delivers something. The price is that when X
drops a delivery (it does, see below), the item arrives late or not at all
until something else brings it in. That trade is made on purpose.

It is a single-user app. It signs in with one X account (`OWNER_USERNAME` in
`wrangler.jsonc`) and refuses every other, since every call is billed to that
account's API credit.

## What it does

- Posts: text, threads, up to four images each with a description, polls, and
  who can reply. Long posts are allowed if the account has Premium.
- Your posts: the ones you made, here or on X, with their like counts. From
  one you can add a follow-up (a reply to yourself, which X shows as a
  thread) or quote it, which posts a link to it, since X sells real quote
  posts to Enterprise only.
- Saving: whatever you are writing is saved on the device as you type it,
  images included, until it is sent. One post (or thread) at a time; each
  reply box keeps its own.
- Notifications: replies, mentions and quotes, each with a reply box and a
  heart. A back-and-forth with one person folds into one row that carries
  the whole conversation. Likes and follows are one cumulative line each
  (per post, and for followers) that rises to the top as it grows, with no
  push. Reposts are left out. A reply to someone else further down your
  thread shows the posts above it, back to yours. Long posts are cut at 280
  characters with a way to read the rest.
- Messages: one-to-one direct messages, read and answered as a chat. X now
  keeps them encrypted (X Chat). Entering the X Chat PIN once in Settings
  fetches the owner's chat keys from X's backup (Juicebox); the Worker keeps
  them sealed with the `CHAT_SECRET` secret and decrypts with X's Chat XDK
  (WASM). See worker/chat.ts. People without encrypted chat still get the
  old unencrypted kind.
- People: tap a face for their profile (bio, counts, latest posts, replies
  and reposts left out) and follow or unfollow from there, from a reply or
  from a conversation. A profile is a cent to look up and its posts half a
  cent each, so both are kept: the profile for a day, the posts topped up at
  most once an hour.
- Push: replies, mentions, quotes and messages reach your phone, and so does
  a warning when the X credit runs low. Tapping one opens the installed app.
- Cost: the real credit balance from X, with the app's own tally of where it
  went.

Left out on purpose: video, GIFs, real quote posts (Enterprise only, see
above), reposts, a timeline, search, scheduling, group messages, settings
for anything the app can work out itself.

## For agents (MCP)

An AI agent can read notime through a remote MCP server at `/mcp`: the
notifications (with whole conversations), your posts with like counts,
direct messages, followers, search across all of it, and what the API has
cost. It is read only: nothing an agent does can post, like or send.

Access is OAuth, as the MCP spec has it. The agent discovers
`/.well-known/oauth-authorization-server`, registers itself, and sends you
to a consent page; you allow it by signing in with X. Settings lists the
agents that have access, with a button to take it back. Everything is read
from notime's own database, so an agent's reading costs nothing, except
`get_post` for a post the app has never seen (half a cent, once).

## How it is built

One Cloudflare Worker serves the built Svelte app and the API, with D1 behind
it. The shell follows the `pwa` skill and its kit (`shared/` holds the kit
files, headers intact).

    src/        the app: views, the composer, drafts, the notification list
    shared/     pwa-kit files: shell, update flow, router, toast, theme
    worker/     the API: X login, posting, the webhook, web push, X Chat,
                people, the MCP server
    migrations/ the D1 schema
    test/       unit tests, plus two browser walkthroughs

Notifications are pushed to us by X rather than polled. The X Activity API
delivers each reply, mention, quote, direct message (old and encrypted),
new follower and the owner's own likes to `/api/webhook/x`, signed with the
app's OAuth 2.0 client secret. The Worker checks the signature, stores the
event, and sends a web push where one is due. X delivers on a best-effort
basis. It documents no delivery guarantee, and developers report dropped
and late deliveries on its forum through 2026. On 30 October 2026 it sent
nothing for nine hours while four encrypted messages came in. There is no
refresh button to make up for it (see the top of this file). Instead, every
hour (a cron at :55) the Worker asks X to replay the last two hours of
deliveries (`POST /2/webhooks/replay`), never reaching back past UTC
midnight: X bills an event once per UTC day however often it is delivered,
and duplicates are dropped by event id, so this closes gaps at no extra
cost. On 30 October a replay brought back the messages X had skipped.
`webhook_log` records every delivery, rejected call, replay and decrypt
failure, and Settings → Connection to X can replay the last 24 hours by
hand. `/api/notifications/check` and `/api/dms/check`
are kept on the server for a future automatic safety net.

Like counts are not delivered: likes by others are billed per event, so the
app reads the like counts of the owner's latest ten posts instead (a tenth
of a cent each) when the notification list opens, at most every 30 minutes.

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
    node test/e2e.mjs             # the whole app in a headless phone (CHROME_PATH to pick a browser)
    node test/updates.mjs         # the service worker update flow
    node test/mcp.mjs             # an MCP client: OAuth round trip, every tool
    node test/textarea.mjs        # a restored long draft fits its box

The browser scripts need `npm run dev` running in another terminal.

## Deploying

    npx wrangler d1 create notime-db          # put the id in wrangler.jsonc
    npx wrangler d1 migrations apply notime-db --remote
    node scripts/secrets.mjs                  # pushes secrets from .env
    npm run deploy

Then open the site and sign in. Signing in registers the webhook with X and
creates the nine subscriptions (see `EVENTS` in worker/setup.ts). The X app
needs "Read and write and Direct message" permissions in the developer
console for messages to work. Settings shows whether each subscription
took, with X's own error text if it did not, and a button to try again.
When a release asks X for a new permission (following did), sign in again
once; the app says so at the top of Notifications.

Secrets the Worker expects: `X_CLIENT_ID`, `X_CLIENT_SECRET`,
`X_BEARER_TOKEN`, `X_CONSUMER_SECRET`, `VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. They live in `.env`, which is not in
git. Do not regenerate the VAPID keys once phones have subscribed: every
existing subscription would silently stop working.

`CHAT_SECRET` is separate: random bytes set straight on the Worker
(`openssl rand -base64 32 | npx wrangler secret put CHAT_SECRET`) and kept
nowhere else. It seals the X Chat keys in D1. Changing it only means
entering the X Chat PIN in Settings again.

## What X charges

Pay per use, as of October 2026: a cent and a half per post, twenty cents
for a post with a link in it, a tenth of a cent per mention or own post read
back, half a cent per reply, mention or quote delivered and a cent per
message. Looking up a person is a cent, someone else's post half a cent, a
message read a cent, a follow a cent and a half. The app caches every user
and post it looks up, never polls, and shows a running estimate in Settings.
