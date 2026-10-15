import { api } from './api'

// The shell is pinned to the visible area and only the view's own scroller
// moves (shared/css/base.css). If the page itself scrolls, or the visible
// area pans away from the top, the whole app slides, top bar included; on
// Android that can happen when the keyboard opens over a focused field. This
// puts it back, and reports what moved and where focus was, so the cause can
// be found from evidence rather than guessed at. A few reports per session.

let sent = 0

function report(why: string) {
  if (sent >= 5) return
  sent++
  const a = document.activeElement as HTMLElement | null
  const box = a instanceof HTMLTextAreaElement ? a : null
  const vv = window.visualViewport
  const data = {
    why,
    hash: location.hash,
    scrollY: Math.round(window.scrollY),
    rootScrollTop: Math.round(document.scrollingElement?.scrollTop ?? 0),
    inner: [innerWidth, innerHeight],
    vv: vv ? { top: Math.round(vv.offsetTop), height: Math.round(vv.height), scale: vv.scale } : null,
    focus: a ? a.tagName + (a.getAttribute('aria-label') ? `[${a.getAttribute('aria-label')}]` : '') : null,
    textarea: box ? { len: box.value.length, caret: box.selectionEnd, height: box.clientHeight, scrollHeight: box.scrollHeight } : null,
    scroller: (() => { const s = document.querySelector('.body'); return s ? { top: Math.round(s.scrollTop), height: s.clientHeight, content: s.scrollHeight } : null })(),
    ua: navigator.userAgent,
  }
  api('/api/client-log', { method: 'POST', body: data }).catch(() => {})
}

export function watchLayout() {
  const check = (why: string) => {
    const vv = window.visualViewport
    if (vv && vv.scale > 1.01) return // pinch zoom pans on purpose
    const vvTop = vv?.offsetTop ?? 0
    if (window.scrollY === 0 && document.scrollingElement?.scrollTop === 0 && vvTop < 1) return
    report(why)
    window.scrollTo(0, 0)
    if (document.scrollingElement) document.scrollingElement.scrollTop = 0
  }
  addEventListener('scroll', () => check('window scroll'), { passive: true })
  window.visualViewport?.addEventListener('scroll', () => check('visual viewport scroll'))
  window.visualViewport?.addEventListener('resize', () => requestAnimationFrame(() => check('visual viewport resize')))
}
