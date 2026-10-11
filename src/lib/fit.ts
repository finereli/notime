// The app's height, measured instead of trusted to 100dvh. Chrome on Android
// updates dvh lazily: after the keyboard closes, after coming back from the
// background, or when Samsung's button bar shows or hides, it can stay a step
// behind, and the page is briefly taller than the screen, its bottom under
// the system bar. innerHeight is the layout viewport, which is what the
// interactive-widget=resizes-content viewport sizes to, and it is current
// whenever we ask. We ask at every moment it can change, and once more a
// beat later because Android reports some of those late.

export function fitToScreen() {
  const root = document.documentElement
  const measure = () => root.style.setProperty('--app-h', `${window.innerHeight}px`)
  const soon = () => {
    measure()
    requestAnimationFrame(measure)
    setTimeout(measure, 250)
  }
  measure()
  addEventListener('resize', soon)
  addEventListener('orientationchange', soon)
  addEventListener('pageshow', soon)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && soon())
  window.visualViewport?.addEventListener('resize', soon)
  // A field losing focus is the keyboard going away.
  document.addEventListener('focusout', soon)
}
