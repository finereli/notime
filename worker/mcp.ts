import type { Env } from './env'
import type { X } from './x'
import { plain } from '../src/lib/rich'
import { chainOf, getNotification, listConversations, listMessages, listNotifications, listOwnPosts, lookPost, parseExtra, realSpend, unreadCount, unreadDms } from './store'
import { monthToDate } from './usage'

// The MCP server: notime's data for an agent, read only. Streamable HTTP,
// stateless: every POST is one JSON-RPC message answered with JSON. All but
// one tool read the app's own database and cost nothing; get_post may ask X
// once for a post the app has never seen (half a cent), then keeps it.

const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']

interface Ctx { env: Env; x: X; token: () => Promise<string>; ownerId: string; username: string }

// Text as a person reads it: entities decoded, t.co links shown as where they go.
const text = (t: unknown, extra: unknown) => (typeof t === 'string' ? plain(t, parseExtra(extra)) : null)
const limitOf = (v: unknown, def: number, max: number) => Math.max(1, Math.min(max, Number(v) || def))

function shapeNotification(r: Record<string, any>) {
  if (r.type === 'likes') return { kind: 'likes', post_id: r.post_id, likes: r.count, your_post: text(r.target_text, r.target_extra), last_grew_at: r.created_at }
  if (r.type === 'follows') return { kind: 'follows', followers: r.count, latest: [r.name || r.username, r.second].filter(Boolean), last_at: r.created_at }
  return {
    id: r.id,
    kind: r.type,
    from: { name: r.name, username: r.username },
    text: text(r.text, r.extra),
    post_id: r.post_id,
    url: r.username && r.post_id ? `https://x.com/${r.username}/status/${r.post_id}` : null,
    in_reply_to_your_post: r.target_text ? text(r.target_text, r.target_extra) : null,
    at: r.created_at,
    unread: !r.read,
    answered: !!(r.replied_post_id || r.answered),
    liked: !!r.liked,
    continues: r.prev_id ?? null,
  }
}

const TOOLS: Array<{ name: string; description: string; inputSchema: Record<string, unknown>; run: (c: Ctx, a: Record<string, any>) => Promise<unknown> }> = [
  {
    name: 'get_account',
    description: "Whose X account this is, and how much is waiting: unread replies, mentions and quotes, and conversations with unread messages.",
    inputSchema: { type: 'object', properties: {} },
    run: async (c) => ({ username: c.username, user_id: c.ownerId, unread_notifications: await unreadCount(c.env.DB), unread_conversations: await unreadDms(c.env.DB) }),
  },
  {
    name: 'list_notifications',
    description:
      "The owner's X notifications, newest first: replies, mentions and quotes (each with who, what they said, and which of the owner's posts it answers, whether the owner answered or liked it, and 'continues' when it carries on an earlier one), plus one line per post with its like count and one line for new followers. Page with 'before' (an 'at' value from the last item).",
    inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'Up to 100, default 30' }, before: { type: 'string', description: 'ISO time; items older than this' }, only_unanswered: { type: 'boolean', description: 'Only replies, mentions and quotes the owner has neither answered nor liked' } } },
    run: async (c, a) => {
      const { items, more } = await listNotifications(c.env.DB, a.before ?? null, limitOf(a.limit, 30, 100))
      let out = items.map(shapeNotification)
      if (a.only_unanswered) out = out.filter((n: any) => n.id && !n.answered && !n.liked)
      return { items: out, more }
    },
  },
  {
    name: 'get_notification',
    description: 'One reply, mention or quote by id, with the whole conversation that led to it, oldest first: what the owner wrote, what they answered, and so on.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: "A notification id from list_notifications, like 'post:2109…'" } }, required: ['id'] },
    run: async (c, a) => {
      const row = await getNotification(c.env.DB, String(a.id))
      if (!row) throw new Error('No notification with that id')
      const chain = await chainOf(c.env.DB, row)
      return { ...shapeNotification(row), conversation: [...chain, row].map((r) => ({ owner_wrote: text(r.target_text, r.target_extra), they_replied: { from: r.name || r.username, text: text(r.text, r.extra), at: r.created_at } })) }
    },
  },
  {
    name: 'list_posts',
    description: "The owner's own top-level posts (no replies), newest first. Page with 'before' (a post id).",
    inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'Up to 100, default 30' }, before: { type: 'string', description: 'A post id; posts older than it' } } },
    run: async (c, a) => {
      const limit = limitOf(a.limit, 30, 100)
      const { items } = await listOwnPosts(c.env.DB, c.ownerId, a.before ?? null, limit)
      const likes = await c.env.DB.prepare(`SELECT post_id, likes FROM post_stats`).all<{ post_id: string; likes: number }>()
      const byId = new Map(likes.results.map((r) => [r.post_id, r.likes]))
      return {
        items: items.map((p) => ({ id: p.id, text: text(p.text, p.extra), at: p.created_at, likes: byId.get(p.id) ?? null, url: `https://x.com/${c.username}/status/${p.id}` })),
        more: items.length === limit,
      }
    },
  },
  {
    name: 'get_post',
    description: "Any X post by id: the owner's, or one that a notification or message links to or quotes. From the app's cache; a post it has never seen is looked up on X once (costs half a cent).",
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'The numeric post id' } }, required: ['id'] },
    run: async (c, a) => {
      if (!/^\d+$/.test(String(a.id))) throw new Error('A post id is a number')
      const p = await lookPost(c.env, c.x, c.token, String(a.id))
      if (!p) throw new Error('X has no such post, or will not show it')
      return { id: p.id, from: { name: p.name, username: p.username }, text: text(p.text, p.extra), at: p.created_at, quotes: p.extra?.quoted ?? null, images: (p.extra?.media ?? []).map((m: any) => m.url), url: p.username ? `https://x.com/${p.username}/status/${p.id}` : null }
    },
  },
  {
    name: 'list_conversations',
    description: "The owner's one-to-one direct message conversations (unencrypted ones; X's API cannot read encrypted chats), newest first, with the latest message and the unread count.",
    inputSchema: { type: 'object', properties: {} },
    run: async (c) => ({
      items: (await listConversations(c.env.DB)).map((r: any) => ({ with: { id: r.partner_id, name: r.name, username: r.username }, latest: { from_owner: r.sender_id === c.ownerId, text: text(r.text, r.extra), at: r.created_at }, unread: r.unread })),
    }),
  },
  {
    name: 'get_conversation',
    description: 'The messages with one person, oldest first. Give the user id from list_conversations, or a username.',
    inputSchema: { type: 'object', properties: { user_id: { type: 'string' }, username: { type: 'string', description: 'Without the @' } } },
    run: async (c, a) => {
      let id = a.user_id ? String(a.user_id) : null
      if (!id && a.username) id = (await c.env.DB.prepare(`SELECT id FROM x_users WHERE lower(username) = lower(?1)`).bind(String(a.username).replace(/^@/, '')).first<{ id: string }>())?.id ?? null
      if (!id) throw new Error('Give a user_id or a username from list_conversations')
      const who = await c.env.DB.prepare(`SELECT name, username FROM x_users WHERE id = ?1`).bind(id).first()
      const msgs = await listMessages(c.env.DB, id)
      return { with: who, messages: msgs.map((m: any) => ({ from_owner: m.sender_id === c.ownerId, text: text(m.text, m.extra), at: m.created_at })) }
    },
  },
  {
    name: 'list_followers',
    description: 'People who followed the owner since notime started listening, newest first.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'Up to 200, default 50' } } },
    run: async (c, a) => {
      const { results } = await c.env.DB
        .prepare(`SELECT u.name, u.username, a.at FROM activity a LEFT JOIN x_users u ON u.id = a.actor_id WHERE a.kind = 'follow' ORDER BY a.at DESC LIMIT ?1`)
        .bind(limitOf(a.limit, 50, 200))
        .all()
      return { items: results }
    },
  },
  {
    name: 'search',
    description: 'Search the text of notifications, the owner\'s posts and direct messages for a word or phrase. Case-insensitive.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number', description: 'Per kind, up to 50, default 20' } }, required: ['query'] },
    run: async (c, a) => {
      const q = `%${String(a.query ?? '').replace(/[%_]/g, '')}%`
      if (q.length < 4) throw new Error('Search for at least two characters')
      const n = limitOf(a.limit, 20, 50)
      const db = c.env.DB
      const [notes, posts, dms] = await Promise.all([
        db.prepare(`SELECT n.id, n.type, n.text, n.created_at, u.name, u.username, x.extra FROM notifications n LEFT JOIN x_users u ON u.id = n.actor_id LEFT JOIN x_posts x ON x.id = n.post_id
                    WHERE n.text LIKE ?1 ORDER BY n.created_at DESC LIMIT ?2`).bind(q, n).all<Record<string, any>>(),
        db.prepare(`SELECT id, text, created_at, extra FROM x_posts WHERE author_id = ?1 AND text LIKE ?2 ORDER BY CAST(id AS INTEGER) DESC LIMIT ?3`).bind(c.ownerId, q, n).all<Record<string, any>>(),
        db.prepare(`SELECT d.partner_id, d.sender_id, d.text, d.created_at, d.extra, u.name, u.username FROM dms d LEFT JOIN x_users u ON u.id = d.partner_id
                    WHERE d.text LIKE ?1 ORDER BY d.created_at DESC LIMIT ?2`).bind(q, n).all<Record<string, any>>(),
      ])
      return {
        notifications: notes.results.map((r) => ({ id: r.id, kind: r.type, from: r.name || r.username, text: text(r.text, r.extra), at: r.created_at })),
        own_posts_and_replies: posts.results.map((r) => ({ id: r.id, text: text(r.text, r.extra), at: r.created_at })),
        messages: dms.results.map((r) => ({ with: r.name || r.username, from_owner: r.sender_id === c.ownerId, text: text(r.text, r.extra), at: r.created_at })),
      }
    },
  },
  {
    name: 'get_usage',
    description: "What the X API has cost: the credit balance X reports, spend read off it, and this month's count of billed operations by kind.",
    inputSchema: { type: 'object', properties: {} },
    run: async (c) => {
      const r = await realSpend(c.env, c.x, await c.token())
      const m = await monthToDate(c.env.DB)
      return { balance_usd: r.credits?.total ?? null, free_credit_expires: r.credits?.expires ?? null, spent_usd: r.spent, spent_since: r.since, spent_this_month_usd: r.spentMonth, this_month_by_kind: m.rows, estimate_at_list_prices_usd: Math.round(m.total * 100) / 100 }
    },
  },
]

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: any }

const reply = (id: Rpc['id'], result: unknown) => ({ jsonrpc: '2.0', id: id ?? null, result })
const error = (id: Rpc['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })

async function handle(c: Ctx, m: Rpc): Promise<object | null> {
  // A notification (no id) gets no answer.
  if (m.id === undefined || m.id === null) return null
  switch (m.method) {
    case 'initialize': {
      const asked = String(m.params?.protocolVersion ?? '')
      return reply(m.id, {
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'notime', title: 'notime (X, read only)', version: '1.0.0' },
        instructions: `Read-only access to @${c.username}'s X account through notime: notifications (replies, mentions, quotes, like counts, followers), their own posts, direct messages, search, and API cost. Nothing here posts, likes or sends.`,
      })
    }
    case 'ping':
      return reply(m.id, {})
    case 'tools/list':
      return reply(m.id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema, annotations: { readOnlyHint: true, openWorldHint: false } })) })
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === m.params?.name)
      if (!tool) return error(m.id, -32602, `Unknown tool: ${m.params?.name}`)
      try {
        const out = await tool.run(c, m.params?.arguments ?? {})
        return reply(m.id, { content: [{ type: 'text', text: JSON.stringify(out, null, 1) }], structuredContent: out })
      } catch (e) {
        return reply(m.id, { content: [{ type: 'text', text: e instanceof Error ? e.message : 'That did not work' }], isError: true })
      }
    }
    default:
      return error(m.id, -32601, `Method not found: ${m.method}`)
  }
}

export async function mcpRequest(request: Request, c: Ctx): Promise<Response> {
  if (request.method !== 'POST') return new Response('This MCP server answers POST only.', { status: 405, headers: { Allow: 'POST' } })
  let body: Rpc | Rpc[]
  try {
    body = await request.json()
  } catch {
    return Response.json(error(null, -32700, 'Parse error'), { status: 400 })
  }
  const batch = Array.isArray(body)
  const list: Rpc[] = Array.isArray(body) ? body : [body]
  const answers = (await Promise.all(list.map((m) => handle(c, m)))).filter(Boolean)
  if (!answers.length) return new Response(null, { status: 202 })
  return Response.json(batch ? answers : answers[0])
}

export const toolNames = TOOLS.map((t) => t.name)
