// Plays an MCP client against `wrangler dev` with the stand-in X (DEV_AUTH):
// discovery, registration, approval, tokens, every tool, refresh, and the
// ways it should say no. Run after test/e2e.mjs so there is data to read.
//   node test/mcp.mjs
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'

const BASE = 'http://127.0.0.1:8787'
const b64u = (b) => Buffer.from(b).toString('base64url')
const get = (path, init) => fetch(BASE + path, { redirect: 'manual', ...init })

// --- unauthenticated: 401 that points at the metadata ---
const bare = await get('/mcp', { method: 'POST', body: '{}' })
assert.equal(bare.status, 401)
assert.match(bare.headers.get('WWW-Authenticate'), /resource_metadata="http:\/\/127\.0\.0\.1:8787\/\.well-known\/oauth-protected-resource"/)

// --- discovery ---
const resource = await (await get('/.well-known/oauth-protected-resource')).json()
assert.equal(resource.resource, BASE + '/mcp')
const meta = await (await get('/.well-known/oauth-authorization-server')).json()
assert.deepEqual(meta.code_challenge_methods_supported, ['S256'])

// --- registration ---
assert.equal((await get('/oauth/register', { method: 'POST', body: JSON.stringify({ redirect_uris: ['http://evil.example/cb'] }) })).status, 400, 'plain http off localhost is refused')
const reg = await (await get('/oauth/register', { method: 'POST', body: JSON.stringify({ client_name: 'Glopus', redirect_uris: ['https://glopus.example/callback'] }) })).json()
assert.match(reg.client_id, /^mcp_/)

// --- authorize: a consent page, then (locally) straight back with a code ---
const verifier = b64u(randomBytes(32))
const challenge = b64u(createHash('sha256').update(verifier).digest())
const q = new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: 'https://glopus.example/callback', code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz', scope: 'read' })
assert.equal((await get('/oauth/authorize?' + q.toString().replace('glopus.example', 'other.example'))).status, 400, 'an unregistered redirect is refused')
const consent = await get('/oauth/authorize?' + q)
const html = await consent.text()
assert.match(html, /Glopus/)
assert.match(html, /cannot post, reply, like or send/)
const cont = html.match(/href="(\/oauth\/continue\?p=[^"]+)"/)[1]
const back = await get(cont.replace(/&amp;/g, '&'))
assert.equal(back.status, 302)
const loc = new URL(back.headers.get('Location'))
assert.equal(loc.origin + loc.pathname, 'https://glopus.example/callback')
assert.equal(loc.searchParams.get('state'), 'xyz')
const code = loc.searchParams.get('code')

// --- token: PKCE is checked, the code works once ---
const form = (o) => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o) })
assert.equal((await get('/oauth/token', form({ grant_type: 'authorization_code', code, client_id: reg.client_id, code_verifier: 'wrong', redirect_uri: 'https://glopus.example/callback' }))).status, 400, 'a wrong verifier is refused')
// The failed attempt used the code up, so go round once more.
const back2 = await get((await (await get('/oauth/authorize?' + q)).text()).match(/href="(\/oauth\/continue\?p=[^"]+)"/)[1].replace(/&amp;/g, '&'))
const code2 = new URL(back2.headers.get('Location')).searchParams.get('code')
const tok = await (await get('/oauth/token', form({ grant_type: 'authorization_code', code: code2, client_id: reg.client_id, code_verifier: verifier, redirect_uri: 'https://glopus.example/callback' }))).json()
assert.equal(tok.token_type, 'Bearer')
assert.ok(tok.access_token && tok.refresh_token)
assert.equal((await get('/oauth/token', form({ grant_type: 'authorization_code', code: code2, client_id: reg.client_id, code_verifier: verifier }))).status, 400, 'a code works once')

// --- MCP ---
let id = 0
const rpc = async (method, params, token = tok.access_token) => {
  const res = await get('/mcp', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) })
  assert.equal(res.status, 200, method)
  return (await res.json()).result
}
const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } })
assert.equal(init.serverInfo.name, 'notime')
assert.equal((await get('/mcp', { method: 'POST', headers: { Authorization: 'Bearer ' + tok.access_token }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) })).status, 202)
const { tools } = await rpc('tools/list')
assert.ok(tools.every((t) => t.annotations.readOnlyHint), 'every tool is read only')
console.log('tools:', tools.map((t) => t.name).join(', '))

const call = async (name, args = {}) => {
  const r = await rpc('tools/call', { name, arguments: args })
  assert.ok(!r.isError, `${name}: ${r.content?.[0]?.text}`)
  return r.structuredContent
}
const account = await call('get_account')
assert.equal(account.username, 'finereli')
const notes = await call('list_notifications', { limit: 50 })
assert.ok(notes.items.some((n) => n.kind === 'reply' && n.from.name === 'Max Kalashnikov'))
assert.ok(notes.items.some((n) => n.kind === 'likes'), 'like counts come through')
assert.ok(!JSON.stringify(notes).includes('t.co/'), 'links are resolved')
const max = notes.items.find((n) => n.continues)
const one = await call('get_notification', { id: max.id })
assert.ok(one.conversation.length >= 2, 'the whole conversation')
const posts = await call('list_posts')
assert.ok(posts.items.length > 0 && posts.items.every((p) => p.url.startsWith('https://x.com/finereli/status/')))
assert.equal((await call('get_post', { id: '5501' })).from.username, 'ana_writes')
const convs = await call('list_conversations')
assert.ok(convs.items.some((c) => c.with.name === 'Ana Lima'))
assert.ok((await call('get_conversation', { username: 'ana_writes' })).messages.length >= 3)
await call('list_followers')
const found = await call('search', { query: 'offline' })
assert.ok(found.notifications.length + found.messages.length > 0)
assert.equal(typeof (await call('get_usage')).balance_usd, 'number')
const bad = await rpc('tools/call', { name: 'get_notification', arguments: { id: 'nope' } })
assert.ok(bad.isError, 'tool errors come back as results')

// --- refresh rotates; the old refresh token is spent ---
const fresh = await (await get('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: reg.client_id }))).json()
assert.ok(fresh.access_token && fresh.access_token !== tok.access_token)
assert.equal((await get('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: reg.client_id }))).status, 400, 'a refresh token works once')
await rpc('ping', {}, fresh.access_token)
assert.equal((await get('/mcp', { method: 'POST', headers: { Authorization: 'Bearer nta_made_up' }, body: '{}' })).status, 401)

console.log('mcp ok')
