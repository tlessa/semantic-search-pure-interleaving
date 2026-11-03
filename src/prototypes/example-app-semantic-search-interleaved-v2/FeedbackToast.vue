<script setup lang="ts">
/**
 * "Thanks for your feedback" toast, Figma "Snackbar" (10066:23469): a Material
 * snackbar, text only, inset 16px at the bottom of the phone column. When it shows
 * and clears is up to the parent.
 */
defineProps<{
  /** The text while the toast shows; `null` hides it. */
  message: string | null
  /** Extra space under the toast, e.g. to clear a bottom bar. */
  bottomOffset?: number
}>()
</script>

<template>
  <Teleport to="body">
    <div
      class="feedback-toast-region semantic-search-roboto"
      role="status"
      aria-live="polite"
      :style="{ '--feedback-toast-bottom-offset': `${bottomOffset ?? 0}px` }"
    >
      <Transition name="feedback-toast">
        <div v-if="message" class="feedback-toast">
          {{ message }}
        </div>
      </Transition>
    </div>
  </Teleport>
</template>

<style scoped>
/* Pinned to the bottom of the phone column (MobileWrapper is at most 412px wide). */
.feedback-toast-region {
  position: fixed;
  left: 50%;
  bottom: calc(var(--feedback-toast-bottom-offset, 0px) + var(--spacing-100, 16px));
  z-index: 95;
  box-sizing: border-box;
  width: min(100vw, 412px);
  padding-inline: var(--spacing-100, 16px);
  transform: translateX(-50%);
  pointer-events: none;
}

/* 68px: the two-line slot (40px) with 14px above and below; one line sits centred. */
.feedback-toast {
  display: flex;
  align-items: center;
  box-sizing: border-box;
  min-height: 68px;
  padding: 14px var(--spacing-100, 16px);
  border-radius: 4px;
  background-color: var(--background-color-interactive-subtle, #f8f9fa);
  color: var(--color-base, #202122);
  font-size: 14px;
  line-height: 20px;
  letter-spacing: 0.25px;
  /* M3 Elevation Light/3. */
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.3),
    0 4px 8px 3px rgba(0, 0, 0, 0.15);
}

.feedback-toast-enter-active,
.feedback-toast-leave-active {
  transition:
    opacity 200ms ease-out,
    transform 200ms ease-out;
}

.feedback-toast-enter-from,
.feedback-toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

@media (prefers-reduced-motion: reduce) {
  .feedback-toast-enter-active,
  .feedback-toast-leave-active {
    transition: none;
  }
}
</style>
