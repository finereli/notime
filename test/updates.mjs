// The update flow, seen working: a page running build A, build B swapped in
// underneath it. Needs `wrangler dev` running. Run: node test/updates.mjs
//   1. a touched, visible page lights the reload icon and a tap moves to B
//   2. a page just launched and never touched reloads into C by itself
//   3. /reset.html loads past the worker and comes back signed in
import { chromium, devices } from 'playwright'
import { execSync } from 'node:child_process'
import assert from 'node:assert/strict'

const BASE = 'http://127.0.0.1:8787'
const build = (n) => { execSync('npx vite build', { env: { ...process.env, BUILD_NUMBER: String(n) }, stdio: 'ignore' }); return new Promise((r) => setTimeout(r, 2500)) }
const version = (page) => page.locator('.build span').innerText()
const check = (page) => page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()))

await build(101)
const browser = await chromium.launch()
const context = await browser.newContext({ ...devices['iPhone 14'] })
const page = await context.newPage()
await page.goto(BASE)
await page.getByRole('button', { name: 'Sign in with X' }).click()
await page.getByLabel('Post text').waitFor()
await page.evaluate(() => navigator.serviceWorker.ready)
await page.reload()
await page.getByLabel('Post text').waitFor()
assert.equal(await page.evaluate(() => !!navigator.serviceWorker.controller), true, 'page is controlled by the worker')
assert.equal(await version(page), 'Version 1.101')

// 1. touched page: the icon lights, nothing reloads until asked
await page.getByLabel('Post text').fill('typing while an update lands')
await page.waitForTimeout(11000) // past the quiet-launch window
await build(102)
await check(page)
await page.locator('.reset-btn.pending').waitFor({ state: 'attached', timeout: 20000 })
assert.equal(await version(page), 'Version 1.101', 'no reload under a live session')
assert.equal(await page.getByLabel('Post text').inputValue(), 'typing while an update lands')
await page.getByRole('button', { name: 'Menu', exact: true }).click()
await page.locator('.reset-btn.pending').click()
await page.getByLabel('Post text').waitFor()
await page.waitForFunction(() => document.querySelector('.build span')?.textContent === 'Version 1.102')
assert.equal(await page.getByLabel('Post text').inputValue(), 'typing while an update lands', 'the draft survives the update')
console.log('1 ok: lit icon, tap, 1.102, draft intact')

// 2. quiet launch: fresh load, no touch, update arrives inside ten seconds
await build(103)
const quiet = await context.newPage()
await quiet.goto(BASE)
await quiet.waitForFunction(() => document.querySelector('.build span')?.textContent === 'Version 1.103', null, { timeout: 20000 })
console.log('2 ok: untouched fresh launch moved itself to 1.103')

// 3. reset.html is served past the worker
const res = await quiet.goto(BASE + '/reset.html')
assert.equal(res.status(), 200)
assert.equal(res.fromServiceWorker(), false, 'reset.html must not come from the worker')
await quiet.getByLabel('Post text').waitFor({ timeout: 20000 })
console.log('3 ok: reset.html bypassed the worker and returned to the app, still signed in')

await browser.close()
console.log('updates ok')
