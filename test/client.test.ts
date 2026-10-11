import { describe, expect, it } from 'vitest'
import { weightedLength } from '../src/lib/text'
import { collapse, who, type Item } from '../src/lib/collapse'
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
  const item = (over: Partial<Item>): Item => ({ id: 'x', type: 'reply', actor_id: 'a', post_id: null, target_post_id: null, text: null, created_at: '2026-10-11T10:00:00.000Z', read: 1, replied_post_id: null, username: 'ana', name: 'Ana', avatar: null, target_text: null, ...over })

  it('folds reposts of one post into one row and leaves replies alone', () => {
    const rows = collapse([
      item({ id: 'like:a:40', type: 'repost', actor_id: 'a', target_post_id: '40', name: 'Ana', read: 0 }),
      item({ id: 'post:51', type: 'reply', actor_id: 'b', name: 'Ben' }),
      item({ id: 'like:b:40', type: 'repost', actor_id: 'b', target_post_id: '40', name: 'Ben' }),
      item({ id: 'like:c:40', type: 'repost', actor_id: 'c', target_post_id: '40', name: 'Cy' }),
      item({ id: 'like:a:41', type: 'repost', actor_id: 'a', target_post_id: '41', name: 'Ana' }),
      item({ id: 'post:52', type: 'reply', actor_id: 'b', name: 'Ben' }),
    ])
    expect(rows.map((r) => r.key)).toEqual(['repost:40', 'post:51', 'repost:41', 'post:52'])
    expect(rows[0].items).toHaveLength(3)
    expect(rows[0].unread).toBe(true)
    expect(who(rows[0])).toBe('Ana and 2 others')
    expect(who(rows[2])).toBe('Ana')
  })

  it('names both people when there are two, and does not count one person twice', () => {
    const rows = collapse([
      item({ id: 'repost:1', type: 'repost', actor_id: 'a', target_post_id: '40', name: 'Ana' }),
      item({ id: 'repost:2', type: 'repost', actor_id: 'b', target_post_id: '40', name: null, username: 'ben' }),
      item({ id: 'repost:3', type: 'repost', actor_id: 'a', target_post_id: '40', name: 'Ana' }),
    ])
    expect(rows).toHaveLength(1)
    expect(who(rows[0])).toBe('Ana and @ben')
  })

  it('keeps follows separate', () => {
    expect(collapse([item({ id: 'follow:a', type: 'follow' }), item({ id: 'follow:b', type: 'follow', actor_id: 'b' })])).toHaveLength(2)
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

  it('parks a draft with content when a new one starts, and drops a blank one', () => {
    let s = write(d.initial('a'), 'half an idea')
    s = d.startNew(s, 'b')
    expect(s.currentId).toBe('b')
    expect(d.parked(s).map((x) => x.id)).toEqual(['a'])
    s = d.startNew(s, 'c')
    expect(Object.keys(s.drafts).sort()).toEqual(['a', 'c'])
  })

  it('opens a parked draft and keeps the one it replaces only if it has content', () => {
    let s = d.startNew(write(d.initial('a'), 'one'), 'b')
    s = d.open(s, 'a')
    expect(s.currentId).toBe('a')
    expect(s.drafts.b).toBeUndefined()
    s = d.open(d.startNew(s, 'c'), 'a')
    expect(s.currentId).toBe('a')
  })

  it('replaces a removed current draft with a blank one', () => {
    const s = d.remove(write(d.initial('a'), 'sent'), 'a', 'b')
    expect(s.currentId).toBe('b')
    expect(s.drafts.a).toBeUndefined()
    expect(d.isEmpty(s.drafts.b)).toBe(true)
  })

  it('keeps one reply draft per notification, listed among the drafts once it has text', () => {
    let s = d.ensureReply(d.initial('a'), 'post:51')
    expect(d.ensureReply(s, 'post:51')).toBe(s)
    expect(d.parked(s)).toEqual([])
    s.drafts[d.replyId('post:51')].posts[0].text = 'thanks'
    expect(d.parked(s).map((x) => x.replyTo)).toEqual(['post:51'])
    // A reply draft is never the main one, even if storage says so.
    const odd = d.load(JSON.stringify({ ...s, currentId: d.replyId('post:51') }), mkId)
    expect(odd.drafts[odd.currentId].replyTo).toBeUndefined()
  })

  it('counts a draft with only an image or only a poll as not empty', () => {
    const img = d.newDraft('a'); img.posts[0].images.push({ id: 'i', alt: '' })
    const poll = d.newDraft('b'); poll.poll = { options: ['x', ''], minutes: 60 }
    const blankPoll = d.newDraft('c'); blankPoll.poll = { options: ['', ''], minutes: 60 }
    expect([d.isEmpty(img), d.isEmpty(poll), d.isEmpty(blankPoll)]).toEqual([false, false, true])
    expect(d.preview(img)).toBe('Images, no text yet')
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
