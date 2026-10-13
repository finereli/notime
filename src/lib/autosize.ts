// A textarea that grows with its text, so the page is the only thing that
// scrolls. Two ways it went wrong:
//
// - Measuring means setting the height to auto for an instant, which makes
//   the page shorter, and the browser answers by pulling the scroll position
//   up; on a phone that left the line being typed under the keyboard. So the
//   scroll position is put back right after, and when typing at the end, the
//   end is kept in view.
// - Measuring only on input left the box short whenever the text's height
//   changed some other way: a draft restored on launch, the width changing,
//   the font arriving. Short, it scrolled inside itself and hid lines. So it
//   also measures after the first frame, when fonts are ready, when its width
//   changes, on focus, and whenever the value passed in changes; and its own
//   scroll stays at the top.
//
//   <textarea use:autosize={{ value: text }} />            grow without limit
//   <textarea use:autosize={{ value: text, max: 180 }} />  then scroll inside

interface Opts { value?: string; max?: number }

function scroller(node: HTMLElement): HTMLElement | null {
  for (let el = node.parentElement; el; el = el.parentElement) {
    const y = getComputedStyle(el).overflowY
    if (y === 'auto' || y === 'scroll') return el
  }
  return null
}

export function autosize(node: HTMLTextAreaElement, opts: Opts = {}) {
  let max = opts.max
  const fit = () => {
    const box = scroller(node)
    const top = box?.scrollTop ?? 0
    node.style.height = 'auto'
    const want = node.scrollHeight + (node.offsetHeight - node.clientHeight) // borders, if any
    node.style.height = (max ? Math.min(want, max) : want) + 'px'
    if (!max) node.scrollTop = 0
    if (!box) return
    box.scrollTop = top
    if (document.activeElement === node && node.selectionEnd === node.value.length) {
      const below = node.getBoundingClientRect().bottom - box.getBoundingClientRect().bottom
      if (below > 0) box.scrollTop += below + 16
    }
  }

  fit()
  const frame = requestAnimationFrame(fit)
  document.fonts?.ready.then(fit).catch(() => {})
  // Only a width change rewraps the text; our own height changes are ignored.
  let width = node.clientWidth
  const watch = new ResizeObserver(() => {
    if (node.clientWidth === width) return
    width = node.clientWidth
    fit()
  })
  watch.observe(node)
  node.addEventListener('input', fit)
  node.addEventListener('focus', fit)

  return {
    update(next: Opts = {}) {
      max = next.max
      fit()
    },
    destroy() {
      cancelAnimationFrame(frame)
      watch.disconnect()
      node.removeEventListener('input', fit)
      node.removeEventListener('focus', fit)
    },
  }
}
