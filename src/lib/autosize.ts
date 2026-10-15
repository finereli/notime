// A textarea that grows with its text, so the page is the only thing that
// scrolls.
//
// Where the browser can do it (CSS field-sizing: content, Chrome 123+,
// Safari 26+), it does: it sizes the box and keeps the caret in view as part
// of the same layout, and this action only caps the height. The JavaScript
// version below is the fallback. It had grown patches (put the scroll back
// after measuring, nudge to the caret, re-measure on every trigger) that
// fought the browser's own caret scrolling: after a paste in the middle, the
// view was left a screen away from the caret, and on Android the whole app
// could be dragged along.
//
//   <textarea use:autosize={{ value: text }} />            grow without limit
//   <textarea use:autosize={{ value: text, max: 180 }} />  then scroll inside

interface Opts { value?: string; max?: number }

const native = typeof CSS !== 'undefined' && CSS.supports('field-sizing', 'content')

export function autosize(node: HTMLTextAreaElement, opts: Opts = {}) {
  const cap = (max?: number) => {
    node.style.maxHeight = max ? `${max}px` : ''
    node.style.overflowY = max ? 'auto' : 'hidden'
  }

  if (native) {
    node.style.setProperty('field-sizing', 'content')
    // field-sizing ignores rows; keep it as the minimum.
    const cs = getComputedStyle(node)
    node.style.minHeight = `calc(${node.rows}lh + ${parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth)}px)`
    cap(opts.max)
    return { update: (next: Opts = {}) => cap(next.max) }
  }

  // Fallback: measure. Height auto for an instant, then the content height.
  let max = opts.max
  const fit = () => {
    node.style.height = 'auto'
    const want = node.scrollHeight + (node.offsetHeight - node.clientHeight)
    node.style.height = (max ? Math.min(want, max) : want) + 'px'
  }
  cap(max)
  fit()
  const frame = requestAnimationFrame(fit)
  node.addEventListener('input', fit)
  return {
    update(next: Opts = {}) {
      max = next.max
      cap(max)
      fit()
    },
    destroy() {
      cancelAnimationFrame(frame)
      node.removeEventListener('input', fit)
    },
  }
}
