// Draw the app icons. The mark is the n of notime followed by a full stop:
// say the thing, and stop. The drawing came out of logos/ (concept 4).
// Run with `node scripts/app-icons.mjs` after changing the drawing.
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'

const PINE = '#1f4a41', PAPER = '#f4f6f3', MARK = '#e0a63c'

// `scale` shrinks the mark toward the centre for the maskable icon, whose
// outer ring the OS may crop.
const mark = (scale = 1, fg = PAPER, dot = MARK) => `
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
    <path d="M124 400V168h64v34c20-26 48-40 82-40 62 0 98 38 98 104v134h-66V278c0-36-16-56-48-56-38 0-64 26-64 70v108z" fill="${fg}"/>
    <circle cx="404" cy="368" r="36" fill="${dot}"/>
  </g>`

const svg = (inner, bg) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${bg}${inner}</svg>`
const rounded = `<rect width="512" height="512" rx="112" fill="${PINE}"/>`
const full = `<rect width="512" height="512" fill="${PINE}"/>`

const files = [
  ['icon-512.png', 512, svg(mark(), rounded)],
  ['icon-192.png', 192, svg(mark(), rounded)],
  ['icon-maskable-512.png', 512, svg(mark(0.72), full)],
  ['apple-touch-icon.png', 180, svg(mark(0.9), full)],
  // Android tints the badge itself, so it is the shape alone in white.
  ['badge-72.png', 72, svg(mark(1.25, '#fff', '#fff'), '')],
]

mkdirSync('public/icons', { recursive: true })
writeFileSync('public/icons/icon.svg', svg(mark(), rounded))
const browser = await chromium.launch()
for (const [name, size, markup] of files) {
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  await page.setContent(`<body style="margin:0;background:transparent">${markup.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`)
  await page.screenshot({ path: `public/icons/${name}`, omitBackground: true })
  await page.close()
}
await browser.close()
console.log('Wrote', files.length, 'icons to public/icons')
