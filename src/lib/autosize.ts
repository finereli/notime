// A textarea that grows with its text. Measuring means setting the height to
// auto for an instant, which makes the page shorter, and the browser answers
// by pulling the scroll position up; on a phone that leaves the line being
// typed under the keyboard. So the scroll position is put back right after,
// and when typing at the end, the end is kept in view.

function scroller(node: HTMLElement): HTMLElement | null {
  for (let el = node.parentElement; el; el = el.parentElement) {
    const y = getComputedStyle(el).overflowY
    if (y === 'auto' || y === 'scroll') return el
  }
  return null
}

export function autosize(node: HTMLTextAreaElement, max?: number) {
  const fit = () => {
    const box = scroller(node)
    const top = box?.scrollTop ?? 0
    node.style.height = 'auto'
    node.style.height = (max ? Math.min(node.scrollHeight, max) : node.scrollHeight) + 'px'
    if (!box) return
    box.scrollTop = top
    if (document.activeElement === node && node.selectionEnd === node.value.length) {
      const below = node.getBoundingClientRect().bottom - box.getBoundingClientRect().bottom
      if (below > 0) box.scrollTop += below + 16
    }
  }
  fit()
  node.addEventListener('input', fit)
  return { destroy: () => node.removeEventListener('input', fit) }
}
