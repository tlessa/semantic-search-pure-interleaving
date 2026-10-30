import { onScopeDispose, ref, type Ref } from 'vue'

/**
 * How much of the bottom of the screen the on-screen keyboard covers, in px (0 when
 * it's closed). iOS Safari doesn't shrink the page for the keyboard — it overlays it —
 * so a bottom bar has to be lifted by this much to sit on top of the keyboard. The
 * visual viewport is the part of the page still visible above the keyboard.
 */
export function useKeyboardInset(): Ref<number> {
  const inset = ref(0)
  const viewport = typeof window === 'undefined' ? null : window.visualViewport
  if (!viewport) return inset

  function update(): void {
    inset.value = Math.max(0, Math.round(window.innerHeight - viewport!.height - viewport!.offsetTop))
  }

  viewport.addEventListener('resize', update)
  viewport.addEventListener('scroll', update)
  update()

  onScopeDispose(() => {
    viewport.removeEventListener('resize', update)
    viewport.removeEventListener('scroll', update)
  })

  return inset
}
