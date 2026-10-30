<script setup lang="ts">
/**
 * "Thanks for your feedback" toast, Figma "Snackbar" (10066:23469): a Material
 * snackbar near the bottom of the screen. Shows while `message` is set; when it
 * clears is up to searchFeedback.ts.
 */
withDefaults(
  defineProps<{
    message: string | null
    /** Height of any bottom bar to clear (e.g. the article's bottom menu), in px. */
    bottomOffset?: number
  }>(),
  { bottomOffset: 0 },
)
</script>

<template>
  <Teleport to="body">
    <!-- Always mounted so screen readers announce the message when it appears. -->
    <div
      class="feedback-toast-region semantic-search-roboto"
      role="status"
      aria-live="polite"
      :style="{ '--feedback-toast-bottom-offset': `${bottomOffset}px` }"
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
/* Centred in the phone column (MobileWrapper is at most 412px wide). */
.feedback-toast-region {
  position: fixed;
  left: 50%;
  bottom: calc(var(--feedback-toast-bottom-offset, 0px) + var(--spacing-100, 16px));
  z-index: 100;
  width: min(349px, calc(100vw - var(--spacing-100, 16px)));
  transform: translateX(-50%);
  pointer-events: none;
}

/* 349 × 68: 14px top and bottom, 16px sides, text centred in the two-line height. */
.feedback-toast {
  display: flex;
  align-items: center;
  box-sizing: border-box;
  min-height: 68px;
  padding: 14px var(--spacing-100, 16px);
  border-radius: 4px;
  background-color: #f8f9fa;
  color: #202122;
  font-size: 14px;
  line-height: 20px;
  letter-spacing: 0.25px;
  /* Material elevation 3 */
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
