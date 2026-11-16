<script setup lang="ts">
/**
 * Result card context menu, Figma "Menu" (10047:7159): opened by a long press on a
 * card (right-click or the menu key on desktop), next to the press point and kept
 * inside the phone column. Material menu: 209px wide, 56px items.
 */
import { computed, nextTick, ref, watch } from 'vue'

export type ResultMenuAction = 'open' | 'open-new-tab' | 'save' | 'share' | 'copy'

const props = defineProps<{
  open: boolean
  /** Where the press happened, in viewport pixels. */
  x: number
  y: number
}>()

const emit = defineEmits<{
  select: [action: ResultMenuAction]
  close: []
}>()

const ITEMS: Array<{ action: ResultMenuAction; label: string }> = [
  { action: 'open', label: 'Open' },
  { action: 'open-new-tab', label: 'Open in new tab' },
  { action: 'save', label: 'Save' },
  { action: 'share', label: 'Share link' },
  { action: 'copy', label: 'Copy link address' },
]

const MENU_WIDTH = 209
const MENU_HEIGHT = 296
const EDGE_GAP = 8
/** MobileWrapper's widest phone column. */
const COLUMN_MAX_WIDTH = 412

/** At the press point; flipped left/up when it would leave the phone column or screen. */
const position = computed(() => {
  const columnLeft = Math.max(0, (window.innerWidth - COLUMN_MAX_WIDTH) / 2)
  const columnRight = Math.min(window.innerWidth, columnLeft + COLUMN_MAX_WIDTH)

  let left = props.x
  if (left + MENU_WIDTH > columnRight - EDGE_GAP) left = props.x - MENU_WIDTH
  left = Math.min(Math.max(left, columnLeft + EDGE_GAP), columnRight - EDGE_GAP - MENU_WIDTH)

  let top = props.y
  if (top + MENU_HEIGHT > window.innerHeight - EDGE_GAP) top = props.y - MENU_HEIGHT
  top = Math.max(top, EDGE_GAP)

  return { left: `${left}px`, top: `${top}px` }
})

const menu = ref<HTMLElement | null>(null)

/**
 * Lifting the finger that long-pressed sends a click to whatever is now under it: the
 * dismiss layer or a menu item. Ignore pointer clicks until a new press starts on the
 * menu. Keyboard clicks (`detail === 0`) always count.
 */
const armed = ref(false)

function isDeliberate(event: MouseEvent): boolean {
  return armed.value || event.detail === 0
}

function onDismissClick(event: MouseEvent): void {
  if (isDeliberate(event)) emit('close')
}

function onItemClick(action: ResultMenuAction, event: MouseEvent): void {
  if (isDeliberate(event)) emit('select', action)
}

function items(): HTMLElement[] {
  return [...(menu.value?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
}

// Focus the first item, as Material menus do, so arrows and Enter work at once.
watch(
  () => props.open,
  async (open) => {
    armed.value = false
    if (!open) return
    await nextTick()
    items()[0]?.focus()
  },
)

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' || event.key === 'Tab') {
    event.preventDefault()
    emit('close')
    return
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  event.preventDefault()
  const list = items()
  const current = list.indexOf(document.activeElement as HTMLElement)
  const step = event.key === 'ArrowDown' ? 1 : -1
  list[(current + step + list.length) % list.length]?.focus()
}
</script>

<template>
  <Teleport to="body">
    <template v-if="open">
      <!-- Invisible layer: a tap anywhere else closes the menu. -->
      <div
        class="result-menu-dismiss"
        aria-hidden="true"
        @pointerdown="armed = true"
        @click="onDismissClick"
        @contextmenu.prevent="emit('close')"
      />
      <div
        ref="menu"
        class="result-menu semantic-search-roboto"
        role="menu"
        :style="position"
        @pointerdown="armed = true"
        @keydown="onKeydown"
      >
        <button
          v-for="item in ITEMS"
          :key="item.action"
          type="button"
          role="menuitem"
          class="result-menu__item"
          @click="onItemClick(item.action, $event)"
        >
          {{ item.label }}
        </button>
      </div>
    </template>
  </Teleport>
</template>

<style scoped>
.result-menu-dismiss {
  position: fixed;
  inset: 0;
  z-index: 95;
}

/* Material menu, elevation 2. */
.result-menu {
  position: fixed;
  z-index: 96;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 209px;
  padding: var(--spacing-50, 8px) 0;
  border-radius: 4px;
  background-color: #fff;
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.3),
    0 2px 6px 2px rgba(0, 0, 0, 0.15);
}

.result-menu__item {
  display: flex;
  align-items: center;
  height: 56px;
  padding: var(--spacing-50, 8px) 12px;
  border: 0;
  background: none;
  color: #202122;
  font: inherit;
  font-size: 16px;
  line-height: 24px;
  letter-spacing: 0.5px;
  text-align: left;
  cursor: pointer;
}

/* Material state layers: 8% on hover, 10% on focus and press. */
.result-menu__item:hover {
  background-color: rgba(29, 27, 32, 0.08);
}

.result-menu__item:focus-visible,
.result-menu__item:active {
  outline: 0;
  background-color: rgba(29, 27, 32, 0.1);
}
</style>
