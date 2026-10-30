// Hold a finger on something (or right-click it) to open a menu. Moving the
// finger cancels, so scrolling never opens it, and the click that follows a
// long press is swallowed, so a row that is also a link does not navigate.
export function longpress(node: HTMLElement, onpress: (x: number, y: number) => void) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let start = { x: 0, y: 0 }
  let fired = false

  const cancel = () => { if (timer) clearTimeout(timer); timer = null }
  const down = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    fired = false
    start = { x: e.clientX, y: e.clientY }
    cancel()
    timer = setTimeout(() => {
      fired = true
      timer = null
      navigator.vibrate?.(10)
      onpress(start.x, start.y)
    }, 500)
  }
  const move = (e: PointerEvent) => { if (timer && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel() }
  const click = (e: MouseEvent) => { if (fired) { e.preventDefault(); e.stopPropagation(); fired = false } }
  const context = (e: MouseEvent) => { e.preventDefault(); cancel(); onpress(e.clientX, e.clientY) }

  node.addEventListener('pointerdown', down)
  node.addEventListener('pointermove', move)
  node.addEventListener('pointerup', cancel)
  node.addEventListener('pointercancel', cancel)
  node.addEventListener('click', click, true)
  node.addEventListener('contextmenu', context)
  return {
    update(fn: (x: number, y: number) => void) { onpress = fn },
    destroy() {
      cancel()
      node.removeEventListener('pointerdown', down)
      node.removeEventListener('pointermove', move)
      node.removeEventListener('pointerup', cancel)
      node.removeEventListener('pointercancel', cancel)
      node.removeEventListener('click', click, true)
      node.removeEventListener('contextmenu', context)
    },
  }
}
