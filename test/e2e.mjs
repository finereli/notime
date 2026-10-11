// Drives the built app against `wrangler dev` with the fake X (DEV_AUTH).
//   npm run build && npx wrangler dev   (in another terminal)
//   node test/e2e.mjs [screenshot-dir]
// It walks the whole thing the way a thumb would and fails loudly on the
// first surprise. Screenshots are for a human to look at afterwards.
import { chromium, devices } from 'playwright'
import { mkdirSync } from 'node:fs'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'

const BASE = 'http://127.0.0.1:8787'
const out = process.argv[2] || 'test-results'
mkdirSync(out, { recursive: true })

// CHROME_PATH lets a machine with a different Playwright build bring its own browser.
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {})
const context = await browser.newContext({ ...devices['iPhone 14'], colorScheme: 'light' })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()) && errors.push(m.text()))
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` })

// --- login ---
await page.goto(BASE)
await page.getByRole('button', { name: 'Sign in with X' }).waitFor()
await shot('01-login')
await page.getByRole('button', { name: 'Sign in with X' }).click()
const box = page.getByLabel('Post text')
await box.waitFor()
assert.equal(new URL(page.url()).hash, '#/', 'the session token is scrubbed from the address bar')

// --- compose: text, an image, a thread, a link ---
await box.fill('Most software gets worse as it grows. The interesting question is what you refuse to add.')
await page.locator('input[type=file]').setInputFiles('public/icons/icon-512.png')
await page.locator('.images img').waitFor()
await page.getByRole('button', { name: 'Describe' }).click()
await page.getByPlaceholder(/Describe this image/).fill('A plain green rectangle')
await page.getByRole('button', { name: 'Add another post' }).click()
await page.getByLabel('Post 2').fill('More at finereli.com')
await page.getByText('Posts with a link cost $0.20 to send.').waitFor()
await shot('02-compose-thread')

// --- drafts survive a reload ---
await page.waitForTimeout(500)
await page.reload()
await page.getByLabel('Post 1').waitFor()
assert.match(await page.getByLabel('Post 1').inputValue(), /^Most software/)
assert.equal(await page.getByLabel('Post 2').inputValue(), 'More at finereli.com')
await page.locator('.images img').waitFor()
await page.getByRole('button', { name: 'Described' }).waitFor()

// --- park it, write another, find the first in Drafts ---
await page.getByRole('button', { name: 'Menu', exact: true }).click()
await page.getByRole('button', { name: /^Drafts/ }).click()
await page.getByRole('button', { name: 'New post' }).click()
await page.getByLabel('Post text').fill('A failure on purpose #fail')
await page.getByRole('button', { name: 'Post', exact: true }).click()
await page.locator('.error').waitFor()
assert.match(await page.locator('.error').innerText(), /not permitted/)
assert.equal(await page.getByLabel('Post text').inputValue(), 'A failure on purpose #fail', 'a refused post keeps its text')
await shot('03-post-refused')
await page.getByLabel('Post text').fill('')
await page.goto(BASE + '/#/drafts')
await page.getByText('Most software gets worse').waitFor()
await shot('04-drafts')
await page.getByText('Most software gets worse').click()

// --- post the thread ---
await page.getByRole('button', { name: 'Post all' }).click()
await page.getByText('Posted, all 2.').waitFor()
await shot('05-posted')
assert.match(await page.getByRole('link', { name: /Open on X/ }).getAttribute('href'), /^https:\/\/x\.com\/finereli\/status\/\d+$/)
await page.getByRole('button', { name: 'Write another' }).click()
assert.equal(await page.getByLabel('Post text').inputValue(), '')

// --- poll ---
await page.getByLabel('Post text').fill('Which do you reach for first?')
await page.getByRole('button', { name: 'Add a poll' }).click()
await page.getByLabel('Choice 1').fill('The keyboard')
await page.getByLabel('Choice 2').fill('A notebook')
await shot('06-poll')
await page.getByRole('button', { name: 'Post', exact: true }).click()
await page.getByText('Posted.').waitFor()
await page.getByRole('button', { name: 'Write another' }).click()

// --- X delivers some events, signed the way X signs them ---
const secret = readFileSync('.dev.vars', 'utf8').match(/^X_CLIENT_SECRET=(.*)$/m)[1]
const now = new Date().toISOString()
const deliver = async (event_type, payload, includes = {}) => {
  const body = JSON.stringify({ data: { event_uuid: crypto.randomUUID(), created_at: now, filter: { user_id: '1000' }, event_type, payload, includes } })
  const res = await fetch(BASE + '/api/webhook/x', { method: 'POST', body, headers: { 'X-Twitter-Webhooks-Signature-OAuth2': 'sha256=' + createHmac('sha256', secret).update(body).digest('base64') } })
  assert.equal(res.status, 200)
}
// Reposts, likes and follows are not notifications here, even if X sends one.
const repost = (id, author) => ({ id, text: 'RT @finereli: Most tools get worse', author_id: author, created_at: now, referenced_tweets: [{ type: 'retweeted', id: '9001' }] })
await deliver('post.repost.create', repost('7102', '4004'), { users: [{ id: '4004', username: 'sam', name: 'Sam Okafor' }] })
await deliver('like.create', { id: 'l1', created_at: now, liking_user_id: '6006', liked_tweet_id: '9001', liked_tweet_author_id: '1000' }, { users: [{ id: '6006', username: 'lee', name: 'Lee Park' }] })
await deliver('follow.follow', { source: { data: { id: '5005', username: 'mira', name: 'Mira Chen' } }, target: { data: { id: '1000', username: 'finereli' } } })

// A back-and-forth: Max replies, you answer (on X itself), Max answers that.
// Long posts arrive whole, not cut at 280.
const maxUser = { id: '7000', username: 'maxk', name: 'Max Kalashnikov' }
const at = (min) => new Date(Date.now() - min * 60000).toISOString()
const long = 'I started with micro SaaS, a Chrome extension, then pivoted to a game as an experiment, because I know the niche. ' + 'Technically it can be anything: SaaS, AI automation, games. '.repeat(4) + 'I am really missing the user-first angle.'
await deliver('post.reply.create', { id: '7201', text: '@finereli thanks for Obviously Awesome. Books are how I learn.', author_id: '7000', created_at: at(30), conversation_id: '9001', referenced_tweets: [{ type: 'replied_to', id: '9001' }] }, { users: [maxUser] })
await deliver('post.reply.create', { id: '7203', text: long.slice(0, 280), note_tweet: { text: long }, author_id: '7000', created_at: at(10), conversation_id: '9001', referenced_tweets: [{ type: 'replied_to', id: '7202' }] }, {
  users: [maxUser],
  tweets: [{ id: '7202', text: '@maxkalashnikoff Start with positioning. Games are more art than science.', author_id: '1000', conversation_id: '9001', referenced_tweets: [{ type: 'replied_to', id: '7201' }] }],
})
// A direct message.
await deliver('dm.received', { direct_message_events: [{ type: 'message_create', id: 'dm-live', created_timestamp: String(Date.now() - 60000), message_create: { target: { recipient_id: '1000' }, sender_id: '2001', message_data: { text: 'One more thing: can I share this with my team?' } } }], users: { '2001': { id: '2001', name: 'Ana Lima', screen_name: 'ana_writes' } } })
assert.equal((await fetch(BASE + '/api/webhook/x', { method: 'POST', body: '{}' })).status, 403, 'an unsigned delivery is refused')
await page.waitForTimeout(800)

// --- notifications ---
await page.getByRole('button', { name: 'Notifications', exact: true }).click()
await page.getByText('Ana Lima').first().waitFor()
await page.getByText('Continues a conversation').waitFor()
await shot('07-notifications')
for (const who of ['Lee Park', 'Sam Okafor', 'Mira Chen']) assert.equal(await page.getByText(who).count(), 0, who + ' never reaches the list')
assert.equal(await page.getByText('Books are how I learn').count(), 0, 'the earlier reply folds into the newer one')
assert.ok(await page.getByText('I am really missing the user-first angle').count(), 'a long reply shows whole')

// --- the conversation, then a like ---
await page.getByText('Continues a conversation').click()
await page.getByText('Books are how I learn').waitFor()
await page.getByText('Games are more art than science').waitFor()
await shot('07b-conversation')
await page.getByRole('button', { name: 'Like', exact: true }).click()
await page.getByRole('button', { name: 'Liked' }).waitFor()
await page.getByRole('button', { name: 'Back' }).click()
const maxRow = page.locator('li', { hasText: 'Continues a conversation' })
assert.equal(await maxRow.getByRole('button', { name: 'Unlike' }).count(), 1, 'the heart shows in the list')
const anaRow = page.locator('li', { hasText: 'clearest explanation' })
await anaRow.getByRole('button', { name: 'Like' }).click()
await anaRow.getByRole('button', { name: 'Unlike' }).waitFor()
await anaRow.getByRole('button', { name: 'Unlike' }).click()
await anaRow.getByRole('button', { name: 'Like' }).waitFor()
await shot('07c-liked')

// --- reply, with a draft that survives leaving ---
await page.getByText('this is the clearest explanation').click()
const reply = page.getByLabel('Post text')
await reply.waitFor()
await page.getByText('You wrote').waitFor()
await reply.fill('I did. Offline is where')
await page.waitForTimeout(500)
await page.getByRole('button', { name: 'Back' }).click()
await page.getByText('this is the clearest explanation').click()
assert.equal(await page.getByLabel('Post text').inputValue(), 'I did. Offline is where')
await page.getByLabel('Post text').fill('I did. Offline is where drafts earn their keep.')
await shot('08-reply')
await page.getByRole('button', { name: 'Reply', exact: true }).click()
await page.getByText('Replied.').waitFor()
await page.getByRole('button', { name: 'Back' }).click()
await page.getByText('You replied').waitFor()

// --- your posts: follow up on one, then quote one ---
await page.goto(BASE + '/#/posts')
await page.getByText('The best feature request').waitFor()
await page.getByText('Which do you reach for first?').first().waitFor() // posted through the app a moment ago
await shot('08b-posts')
await page.locator('li', { hasText: 'Most tools get worse' }).getByRole('link', { name: 'Follow up' }).click()
await page.getByLabel('Post text').fill('A follow-up, a day later: stopping is a feature.')
await page.getByRole('button', { name: 'Add another post' }).waitFor()
await shot('08c-follow-up')
await page.getByRole('button', { name: 'Post', exact: true }).click()
await page.getByText('Posted.').waitFor()
await page.getByRole('button', { name: 'Back' }).click()
await page.getByText('A follow-up, a day later').first().waitFor()

await page.locator('li', { hasText: 'The best feature request' }).getByRole('link', { name: 'Quote' }).click()
await page.getByLabel('Post text').fill('Still true.')
await page.getByRole('button', { name: 'Quote', exact: true }).click()
await page.locator('.error').waitFor()
assert.match(await page.locator('.error').innerText(), /not available on your current plan/)
await shot('08d-quote-refused')
await page.getByRole('button', { name: 'quote with a link instead' }).click()
assert.match(await page.getByLabel('Post text').inputValue(), /^Still true\. https:\/\/x\.com\/finereli\/status\/7500$/)
await page.getByText('Posts with a link cost $0.20 to send.').waitFor()
await page.getByLabel('Post text').fill('')

// --- long posts: no setting; when X will not say, X decides at send time ---
await page.goto(BASE + '/#/')
await page.getByLabel('Post text').fill('word '.repeat(70))
await page.getByText(/a long post/).waitFor()
assert.equal(await page.getByRole('button', { name: 'Post', exact: true }).isDisabled(), false)
await shot('08e-long-post')
await page.getByLabel('Post text').fill('')

// --- messages ---
await page.goto(BASE + '/#/messages')
await page.getByText('Tomasz Nowak').waitFor()
await page.getByText('can I share this with my team?').waitFor()
await shot('09a-messages')
await page.getByText('Ana Lima').click()
await page.getByText('Loved the post about small tools').waitFor()
const msg = page.getByRole('textbox', { name: 'Message' })
await msg.fill('Sure, go ahead.')
await page.getByRole('button', { name: 'Back' }).click()
await page.getByText('Ana Lima').click()
assert.equal(await page.getByRole('textbox', { name: 'Message' }).inputValue(), 'Sure, go ahead.', 'a half-written message waits')
await page.getByRole('button', { name: 'Send' }).click()
await page.locator('.mine', { hasText: 'Sure, go ahead.' }).locator('.meta', { hasText: /\d/ }).waitFor()
await page.getByRole('textbox', { name: 'Message' }).fill('this one fails #fail')
await page.getByRole('button', { name: 'Send' }).click()
await page.getByText('You cannot send messages to this user.').waitFor()
await shot('09b-chat')
await page.getByRole('button', { name: 'Back' }).click()
await page.getByText('You: Sure, go ahead.').waitFor()
await page.getByRole('button', { name: 'New message' }).click()
await page.getByPlaceholder('@username').fill('@ruth')
await page.getByRole('button', { name: 'Write' }).click()
await page.getByText('No messages here yet').waitFor()
await page.goto(BASE + '/#/messages')
await page.getByRole('button', { name: 'New message' }).click()
await page.getByPlaceholder('@username').fill('nobody')
await page.getByRole('button', { name: 'Write' }).click()
await page.getByText('There is no @nobody on X').waitFor()

// --- settings, light and dark ---
await page.goto(BASE + '/#/settings')
await page.getByText('Connection to X').waitFor()
await page.getByText('$19.81 left on X').waitFor()
await page.getByText(/spent since/).waitFor()
assert.equal(await page.getByText(/reposts and follows/).count(), 0, 'no notification toggles')
assert.equal(await page.getByText('Post length').count(), 0, 'no long post toggle')
await shot('09-settings')
await page.getByRole('button', { name: 'Menu', exact: true }).click()
await page.getByRole('button', { name: 'Dark mode' }).waitFor()
await shot('10-drawer')
await page.getByRole('button', { name: 'Dark mode' }).click()
await page.getByRole('button', { name: 'Close menu' }).click({ position: { x: 370, y: 400 } })
await page.waitForTimeout(400)
await shot('11-settings-dark')
await page.goto(BASE + '/#/notifications')
await page.getByText('Ana Lima').first().waitFor()
await shot('12-notifications-dark')
await page.goto(BASE + '/#/')
await page.getByLabel('Post text').fill('Dark mode should feel like the same desk with the lamp off.')
await shot('13-compose-dark')
await page.getByLabel('Post text').fill('')

// --- no horizontal overflow anywhere we have been ---
for (const hash of ['#/', '#/notifications', '#/drafts', '#/settings', '#/messages', '#/m/2001', '#/posts']) {
  await page.goto(BASE + '/' + hash)
  await page.waitForTimeout(150)
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll on ' + hash)
}

// --- sign out drops to login, drafts stay ---
await page.goto(BASE + '/#/')
await page.getByLabel('Post text').fill('kept across sign out')
await page.waitForTimeout(500)
await page.getByRole('button', { name: 'Menu', exact: true }).click()
await page.getByRole('button', { name: 'Sign out' }).click()
await page.getByRole('button', { name: 'Sign in with X' }).click()
assert.equal(await page.getByLabel('Post text').inputValue(), 'kept across sign out')
await page.getByLabel('Post text').fill('')

// --- desktop: the drawer is a permanent sidebar ---
const wide = await browser.newContext({ viewport: { width: 1200, height: 800 }, storageState: await context.storageState() })
const desk = await wide.newPage()
await desk.goto(BASE + '/#/notifications')
await desk.getByText('Ana Lima').first().waitFor()
await desk.waitForTimeout(700)
await desk.screenshot({ path: `${out}/14-desktop.png` })

assert.deepEqual(errors, [], 'no console or page errors')
await browser.close()
console.log('e2e ok')
