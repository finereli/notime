// A long draft restored on launch must not hide inside its own box: the
// composer grows to fit, and grows again when the width changes.
//   node test/textarea.mjs   (with npm run dev running)
import { chromium, devices } from 'playwright'
import assert from 'node:assert/strict'
const b = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {})
const ctx = await b.newContext({ ...devices['Galaxy S9+'] })
const p0 = await ctx.newPage()
await p0.goto('http://127.0.0.1:8787/api/auth/login'); await p0.waitForTimeout(800); await p0.close()
const text = ('Leaders have always had that same problem and the good ones put a lot of emphasis on rest and recovery. '.repeat(3) + '\n\n').repeat(4)
await ctx.addInitScript((t) => localStorage.setItem('notime.drafts.v1', JSON.stringify({ currentId: 'd1', drafts: { d1: { id: 'd1', posts: [{ text: t, images: [] }], poll: null, replySettings: 'everyone', updatedAt: 1 } } })), text)
const p = await ctx.newPage()
await p.goto('http://127.0.0.1:8787/#/'); await p.waitForTimeout(700)
const m = () => p.evaluate(() => { const t = document.querySelector('textarea'); return { hidden_px: t.scrollHeight - t.clientHeight, inner_scroll: t.scrollTop, height: t.clientHeight, chars: t.value.length } })
const a = await m()
await p.setViewportSize({ width: 280, height: 700 }); await p.waitForTimeout(400)
const n = await m()
assert.equal(a.chars, text.length, 'the draft came back')
assert.equal(a.hidden_px, 0, 'a restored draft fits its box')
assert.equal(n.hidden_px, 0, 'a narrower screen re-fits it')
console.log('textarea ok')
await b.close()
