// Turning a post's text and what X said about it (see Extra in
// worker/events.ts) into something worth reading: t.co links become the
// address they stand for, a link to the post's own image disappears in
// favour of the image, and a link to another post becomes a card.

export interface Extra {
  urls?: Array<{ u: string; x: string; d: string; m?: 1 }>
  media?: Array<{ type: string; url: string; alt?: string; w?: number; h?: number }>
  quoted?: string
}

export type Part = { t: 'text'; s: string } | { t: 'link'; href: string; label: string }

export interface Rich { parts: Part[]; media: NonNullable<Extra['media']>; quotes: string[] }

const TCO = /https?:\/\/t\.co\/[A-Za-z0-9]+/g

// X sends text HTML-escaped (&amp;, &lt;, &gt;). Svelte escapes on output
// itself, so the text has to be plain first or "&" shows up as "&amp;".
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' }
export function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all
    }
    return NAMED[e.toLowerCase()] ?? all
  })
}
const STATUS = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/[^/?#]+\/status\/(\d+)(\/(?:photo|video)\/\d+)?/

export function rich(text: string | null | undefined, extra?: Extra | null): Rich {
  const parts: Part[] = []
  const quotes: string[] = []
  const src = text ?? ''
  let at = 0
  // Text next to text (a dropped link between them) is one run.
  const push = (raw: string) => {
    const s = decode(raw)
    if (!s) return
    const prev = parts[parts.length - 1]
    if (prev?.t === 'text') prev.s += s
    else parts.push({ t: 'text', s })
  }
  for (const m of src.matchAll(TCO)) {
    push(src.slice(at, m.index))
    at = m.index! + m[0].length
    const e = extra?.urls?.find((x) => x.u === m[0])
    if (e?.m) continue
    const status = e ? e.x.match(STATUS) : null
    if (status) {
      // A post's own photo link stands for the image shown below it; a link
      // to another post becomes a card.
      if (!status[2] && !quotes.includes(status[1])) quotes.push(status[1])
      continue
    }
    parts.push(e ? { t: 'link', href: e.x, label: e.d } : { t: 'link', href: m[0], label: m[0].replace(/^https?:\/\//, '') })
  }
  push(src.slice(at))
  // What the removed links leave behind at the end is only space.
  const last = parts[parts.length - 1]
  if (last?.t === 'text') {
    last.s = last.s.replace(/\s+$/, '')
    if (!last.s) parts.pop()
  }
  if (extra?.quoted && !quotes.includes(extra.quoted)) quotes.push(extra.quoted)
  return { parts, media: extra?.media ?? [], quotes }
}

// The same, flattened to a line of text, for previews and context.
export function plain(text: string | null | undefined, extra?: Extra | null): string {
  const r = rich(text, extra)
  let s = r.parts.map((p) => (p.t === 'text' ? p.s : p.label)).join('')
  if (!s && r.media.length) s = r.media.length === 1 ? 'An image' : `${r.media.length} images`
  if (!s && r.quotes.length) s = 'A post'
  return s
}

// The first `limit` characters (links count by their label), cut at a word
// when one is near. `cut` says whether anything was left out.
export function clip(parts: Part[], limit: number): { parts: Part[]; cut: boolean } {
  let left = limit
  const out: Part[] = []
  for (const p of parts) {
    const len = [...(p.t === 'text' ? p.s : p.label)].length
    if (len <= left) {
      out.push(p)
      left -= len
      continue
    }
    if (p.t === 'text' && left > 0) {
      let s = [...p.s].slice(0, left).join('')
      const space = s.search(/\s\S*$/)
      if (space > s.length - 40 && space > 0) s = s.slice(0, space)
      out.push({ t: 'text', s })
    }
    const last = out[out.length - 1]
    if (last?.t === 'text') last.s = last.s.replace(/\s+$/, '')
    return { parts: out, cut: true }
  }
  return { parts: out, cut: false }
}
