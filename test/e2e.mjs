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

const browser = await chromium.launch()
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
const repost = (id, author) => ({ id, text: 'RT @finereli: Most tools get worse', author_id: author, created_at: now, referenced_tweets: [{ type: 'retweeted', id: '9001' }] })
await deliver('post.repost.create', repost('7101', '2001'), { users: [{ id: '2001', username: 'ana_writes', name: 'Ana Lima' }] })
await deliver('post.repost.create', repost('7102', '4004'), { users: [{ id: '4004', username: 'sam', name: 'Sam Okafor' }] })
await deliver('like.create', { id: 'l1', created_at: now, liking_user_id: '6006', liked_tweet_id: '9001', liked_tweet_author_id: '1000' }, { users: [{ id: '6006', username: 'lee', name: 'Lee Park' }] })
await deliver('follow.follow', { source: { data: { id: '5005', username: 'mira', name: 'Mira Chen' } }, target: { data: { id: '1000', username: 'finereli' } } })
assert.equal((await fetch(BASE + '/api/webhook/x', { method: 'POST', body: '{}' })).status, 403, 'an unsigned delivery is refused')
await page.waitForTimeout(800)

// --- notifications ---
await page.getByRole('button', { name: 'Notifications', exact: true }).click()
await page.getByText('Ana Lima').first().waitFor()
await shot('07-notifications')
assert.ok(await page.getByText(/and Sam Okafor|and Ana Lima/).count(), 'reposts of one post fold into one row')
assert.equal(await page.getByText('Lee Park').count(), 0, 'likes never reach the list')

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

// --- long posts: held at 280 until allowed in settings ---
await page.goto(BASE + '/#/')
await page.getByLabel('Post text').fill('word '.repeat(70))
await page.getByText(/over the limit of 280/).waitFor()
assert.equal(await page.getByRole('button', { name: 'Post', exact: true }).isDisabled(), true)
await page.goto(BASE + '/#/settings')
await page.getByRole('button', { name: 'Allow long posts' }).click()
await page.getByRole('button', { name: 'Limit posts to 280 characters' }).waitFor()
await page.goto(BASE + '/#/')
await page.getByText(/a long post/).waitFor()
assert.equal(await page.getByRole('button', { name: 'Post', exact: true }).isDisabled(), false)
await shot('08e-long-post')
await page.getByLabel('Post text').fill('')

// --- settings, light and dark ---
await page.goto(BASE + '/#/settings')
await page.getByText('Connection to X').waitFor()
await page.getByText('this month, roughly').waitFor()
await page.getByRole('button', { name: 'Also notify me about reposts' }).click()
await page.getByRole('button', { name: 'Stop notifying me about reposts' }).waitFor()
await page.getByRole('button', { name: 'Stop notifying me about reposts' }).click()
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
for (const hash of ['#/', '#/notifications', '#/drafts', '#/settings']) {
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
