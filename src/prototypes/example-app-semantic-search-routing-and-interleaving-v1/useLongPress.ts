import { onScopeDispose } from 'vue'

/** How long a touch must stay down, and how far it may drift, to count as a long press. */
const LONG_PRESS_MS = 500
const MOVE_TOLERANCE_PX = 10

/**
 * Touch/pen long press on a list item. Mouse is left to right-click (`contextmenu`).
 * A long press is followed by a click when the finger lifts: call `consumeClick()`
 * first in the click handler and skip the tap when it returns true.
 */
export function useLongPress<T>(onLongPress: (item: T, point: { x: number; y: number }) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let start: { x: number; y: number } | null = null
  let suppressClick = false

  function cancel(): void {
    if (timer) clearTimeout(timer)
    timer = undefined
  }

  function onPointerDown(item: T, event: PointerEvent): void {
    suppressClick = false
    cancel()
    if (event.pointerType === 'mouse') return
    start = { x: event.clientX, y: event.clientY }
    const point = start
    timer = setTimeout(() => {
      timer = undefined
      suppressClick = true
      onLongPress(item, point)
    }, LONG_PRESS_MS)
  }

  function onPointerMove(event: PointerEvent): void {
    if (!timer || !start) return
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > MOVE_TOLERANCE_PX) cancel()
  }

  function consumeClick(): boolean {
    const suppressed = suppressClick
    suppressClick = false
    return suppressed
  }

  onScopeDispose(cancel)

  return { onPointerDown, onPointerMove, onPointerUp: cancel, onPointerCancel: cancel, cancel, consumeClick }
}
