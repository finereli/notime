import { describe, expect, it } from 'vitest'
import { weightedLength } from '../src/lib/text'
import { collapse, handled, type Item } from '../src/lib/collapse'
import * as d from '../src/lib/drafts-core'
import { ago } from '../src/lib/time'

describe('character count', () => {
  it('counts plain text one per character', () => {
    expect(weightedLength('')).toBe(0)
    expect(weightedLength('hello world')).toBe(11)
    expect(weightedLength('café')).toBe(4)
  })
  it('counts any link as 23', () => {
    expect(weightedLength('https://example.com/a/very/long/path?with=query&and=more')).toBe(23)
    expect(weightedLength('read finereli.com now')).toBe(5 + 23 + 4)
  })
  it('counts emoji and CJK as two', () => {
    expect(weightedLength('👍')).toBe(2)
    expect(weightedLength('👨‍👩‍👧‍👦')).toBe(2)
    expect(weightedLength('日本語')).toBe(6)
    expect(weightedLength('hi 👋')).toBe(5)
  })
  it('counts Hebrew and Cyrillic as one each', () => {
    expect(weightedLength('שלום')).toBe(4)
    expect(weightedLength('привет')).toBe(6)
  })
})

describe('collapsing the list', () => {
  const item = (over: Partial<Item>): Item => ({ id: 'x', type: 'reply', actor_id: 'a', post_id: null, target_post_id: null, text: null, created_at: '2026-10-11T10:00:00.000Z', read: 1, replied_post_id: null, username: 'max', name: 'Max', avatar: null, target_text: null, prev_id: null, ...over })

  // The shape of a real afternoon: Max replied, you answered twice, he
  // answered each, and one branch went on for two more rounds. Newest first,
  // as the server sends them.
  const max = [
    item({ id: 'm5', prev_id: 'm4', created_at: '2026-10-11T16:34:00Z', read: 0 }),
    item({ id: 'm4', prev_id: 'm3', created_at: '2026-10-11T16:02:00Z' }),
    item({ id: 'm3', prev_id: 'm1', created_at: '2026-10-11T15:57:00Z' }),
    item({ id: 'm2', prev_id: 'm1', created_at: '2026-10-11T15:55:00Z' }),
    item({ id: 'o1', actor_id: 'b', name: 'Ben', created_at: '2026-10-11T15:40:00Z' }),
    item({ id: 'm1', created_at: '2026-10-11T15:35:00Z' }),
  ]

  it('folds a back-and-forth into its newest reply, one row per branch', () => {
    const rows = collapse(max)
    expect(rows.map((r) => r.key)).toEqual(['m5', 'm2', 'o1'])
    expect(rows[0].items.map((i) => i.id)).toEqual(['m1', 'm3', 'm4', 'm5'])
    expect(rows[1].items.map((i) => i.id)).toEqual(['m1', 'm2'])
    expect(rows[0].unread).toBe(true)
    expect(rows[1].unread).toBe(false)
  })

  it('stands alone when the earlier part is not loaded, and survives a loop', () => {
    expect(collapse([item({ id: 'a', prev_id: 'gone' })]).map((r) => r.items.length)).toEqual([1])
    const loop = collapse([item({ id: 'a', prev_id: 'b' }), item({ id: 'b', prev_id: 'a' })])
    expect(loop.map((r) => r.key).sort()).toEqual(['a', 'b'])
  })

  it('calls a reply dealt with once it is answered or liked', () => {
    expect(handled(item({}))).toBe(false)
    expect(handled(item({ answered: true }))).toBe(true)
    expect(handled(item({ liked: true }))).toBe(true)
    expect(handled(item({ replied_post_id: '9' }))).toBe(true)
  })
})

describe('drafts', () => {
  let n = 0
  const mkId = () => 'id' + ++n
  const write = (s: d.DraftState, text: string) => { s.drafts[s.currentId].posts[0].text = text; return s }

  it('starts with one blank draft, from nothing or from garbage', () => {
    for (const raw of [null, '', 'not json', '{"currentId":5}', '{"currentId":"gone","drafts":{}}']) {
      const s = d.load(raw, mkId)
      expect(d.isEmpty(s.drafts[s.currentId])).toBe(true)
    }
  })

  it('survives a round trip through storage with text, thread, images and poll intact', () => {
    const s = write(d.initial('a'), 'first')
    s.drafts.a.posts.push({ text: 'second', images: [{ id: 'img1', alt: 'a cat' }] })
    s.drafts.a.poll = { options: ['yes', 'no'], minutes: 60 }
    s.drafts.a.replySettings = 'following'
    const back = d.load(JSON.stringify(s), mkId)
    expect(back).toEqual(s)
  })

  it('keeps a single Write draft when storage holds several from before', () => {
    const old = { currentId: 'b', drafts: { a: { ...d.newDraft('a'), updatedAt: 5 }, b: d.newDraft('b'), c: { ...d.newDraft('c'), updatedAt: 9 }, [d.replyId('post:1')]: d.newDraft(d.replyId('post:1'), 'post:1') } }
    old.drafts.a.posts[0].text = 'older idea'
    old.drafts.c.posts[0].text = 'newer idea'
    old.drafts[d.replyId('post:1')].posts[0].text = 'thanks'
    const s = d.load(JSON.stringify(old), mkId)
    // The current one was blank, so the most recent one with words takes its place.
    expect(s.currentId).toBe('c')
    expect(Object.keys(s.drafts).sort()).toEqual(['c', d.replyId('post:1')].sort())
    // A current draft with content wins over a newer one.
    old.drafts.b.posts[0].text = 'what I was writing'
    expect(d.load(JSON.stringify(old), mkId).currentId).toBe('b')
  })

  it('replaces a removed current draft with a blank one', () => {
    const s = d.remove(write(d.initial('a'), 'sent'), 'a', 'b')
    expect(s.currentId).toBe('b')
    expect(s.drafts.a).toBeUndefined()
    expect(d.isEmpty(s.drafts.b)).toBe(true)
  })

  it('keeps one reply draft per notification, never as the Write draft', () => {
    const s = d.ensureReply(d.initial('a'), 'post:51')
    expect(d.ensureReply(s, 'post:51')).toBe(s)
    s.drafts[d.replyId('post:51')].posts[0].text = 'thanks'
    const odd = d.load(JSON.stringify({ ...s, currentId: d.replyId('post:51') }), mkId)
    expect(odd.drafts[odd.currentId].replyTo).toBeUndefined()
    expect(odd.drafts[d.replyId('post:51')].posts[0].text).toBe('thanks')
  })

  it('counts a draft with only an image or only a poll as not empty', () => {
    const img = d.newDraft('a'); img.posts[0].images.push({ id: 'i', alt: '' })
    const poll = d.newDraft('b'); poll.poll = { options: ['x', ''], minutes: 60 }
    const blankPoll = d.newDraft('c'); blankPoll.poll = { options: ['', ''], minutes: 60 }
    expect([d.isEmpty(img), d.isEmpty(poll), d.isEmpty(blankPoll)]).toEqual([false, false, true])
  })

  it('lists every image id still in use', () => {
    const s = d.initial('a')
    s.drafts.a.posts[0].images.push({ id: 'i1', alt: '' })
    s.drafts.a.posts.push({ text: '', images: [{ id: 'i2', alt: '' }] })
    expect([...d.imageIds(s)].sort()).toEqual(['i1', 'i2'])
  })
})

describe('relative time', () => {
  const now = Date.parse('2026-10-11T12:00:00Z')
  const back = (s: number) => new Date(now - s * 1000).toISOString()
  it('walks the ladder', () => {
    expect([ago(back(10), now), ago(back(300), now), ago(back(3 * 3600), now), ago(back(2 * 86400), now), ago(back(21 * 86400), now)]).toEqual(['now', '5m', '3h', '2d', '3w'])
  })
})
