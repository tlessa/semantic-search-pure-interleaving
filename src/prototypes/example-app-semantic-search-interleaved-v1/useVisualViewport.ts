import { onScopeDispose, reactive } from 'vue'

/**
 * The part of the page actually visible: below the browser bars, above the on-screen
 * keyboard. Mobile Safari doesn't resize the page for the keyboard — it overlays it and
 * pans the page around — so a screen that must keep its bottom bar on top of the
 * keyboard pins itself to this instead of to the window.
 */
export function useVisualViewport() {
  const state = reactive({
    /** Where the visible area starts, in layout px (Safari pans it while typing). */
    top: 0,
    height: typeof window === 'undefined' ? 0 : window.innerHeight,
    /** How much of the window the keyboard covers (0 when it's closed). */
    keyboardInset: 0,
  })

  const viewport = typeof window === 'undefined' ? null : window.visualViewport

  function update(): void {
    if (!viewport) {
      state.height = window.innerHeight
      return
    }
    state.top = Math.round(viewport.offsetTop)
    state.height = Math.round(viewport.height)
    state.keyboardInset = Math.max(
      0,
      Math.round(window.innerHeight - viewport.height - viewport.offsetTop),
    )
  }

  const target: EventTarget = viewport ?? window
  target.addEventListener('resize', update)
  viewport?.addEventListener('scroll', update)
  update()

  onScopeDispose(() => {
    target.removeEventListener('resize', update)
    viewport?.removeEventListener('scroll', update)
  })

  return state
}
