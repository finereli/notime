// How X counts a post. Most characters weigh one, CJK and emoji weigh two,
// and any link weighs 23 no matter how long it is. This follows the published
// twitter-text v3 ranges closely enough for a counter. X has the last word.

export { hasUrl } from '../../worker/usage'

const URL_G = /(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|co|dev|app|ai|me|ly|gg|xyz|info|blog|tech|so|sh|to|fm|tv|us|uk|ca|de|fr|il)\b(?:\/\S*)?/gi
const EMOJI = /\p{Extended_Pictographic}/u
const light = (cp: number) => cp <= 4351 || (cp >= 8192 && cp <= 8205) || (cp >= 8208 && cp <= 8223) || (cp >= 8242 && cp <= 8247)

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null

export function weightedLength(input: string): number {
  const text = input.normalize('NFC')
  let total = 0
  const rest = text.replace(URL_G, () => { total += 23; return '' })
  const graphemes = segmenter ? Array.from(segmenter.segment(rest), (s) => s.segment) : Array.from(rest)
  for (const g of graphemes) {
    if (EMOJI.test(g)) { total += 2; continue }
    for (const ch of g) total += light(ch.codePointAt(0)!) ? 1 : 2
  }
  return total
}

export const LIMIT = 280
// What X allows a Premium account in one post.
export const LONG_LIMIT = 25000
