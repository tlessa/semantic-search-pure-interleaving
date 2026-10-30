<script setup lang="ts">
/**
 * "Search within articles" info sheet, Figma 10066:25228: opened from the ⓘ next to
 * the Beta badge. Explains the passages, shows an example result (the default slot,
 * so the search page renders it with the real card styles) and offers "Learn more"
 * and "Turn off feature".
 */
import { CdxIcon } from '@wikimedia/codex'
import { cdxIconSearch } from '@wikimedia/codex-icons'

import closeIcon from './assets/close.svg'
import openInNewIcon from './assets/open-in-new.svg'

defineProps<{
  open: boolean
  /** The example question above the example card. */
  exampleQuestion: string
}>()

const emit = defineEmits<{
  close: []
  learnMore: []
  turnOff: []
}>()
</script>

<template>
  <Teleport to="body">
    <!-- Overlay behind the sheet; tapping it closes the sheet. -->
    <Transition name="search-info-overlay">
      <div v-if="open" class="search-info-overlay" aria-hidden="true" @click="emit('close')" />
    </Transition>

    <Transition name="search-info-sheet">
      <section
        v-if="open"
        class="search-info-sheet semantic-search-roboto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="search-info-sheet-title"
        @keydown.esc="emit('close')"
      >
        <div class="search-info-sheet__title-row">
          <h2 id="search-info-sheet-title" class="search-info-sheet__title">
            Search within articles
          </h2>
          <button type="button" class="search-info-sheet__close" aria-label="Close" @click="emit('close')">
            <img :src="closeIcon" alt="" width="24" height="24">
          </button>
        </div>

        <div class="search-info-sheet__content">
          <p class="search-info-sheet__description">
            Some results include passages drawn from articles that people researched, wrote,
            and edited, each one backed by cited sources you can check. This is an experiment
            to help us improve search.
          </p>

          <p class="search-info-sheet__question">
            <CdxIcon :icon="cdxIconSearch" class="search-info-sheet__question-icon" />
            {{ exampleQuestion }}
          </p>

          <div class="search-info-sheet__example">
            <slot />
          </div>
        </div>

        <div class="search-info-sheet__actions">
          <button type="button" class="search-info-sheet__action" @click="emit('learnMore')">
            Learn more
            <img :src="openInNewIcon" alt="" width="20" height="20">
          </button>
          <button type="button" class="search-info-sheet__action" @click="emit('turnOff')">
            Turn off feature
          </button>
        </div>
      </section>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* Material scrim (black, 32%), covering the phone column. */
.search-info-overlay {
  position: fixed;
  top: 0;
  bottom: 0;
  left: 50%;
  z-index: 89;
  width: min(100vw, 412px);
  background-color: rgba(0, 0, 0, 0.32);
  transform: translateX(-50%);
}

/*
 * Pinned to the bottom of the phone column (MobileWrapper is at most 412px wide).
 * Figma: 359 × 661, 28px top corners; scrolls if the screen is shorter.
 */
.search-info-sheet {
  position: fixed;
  left: 50%;
  bottom: 0;
  z-index: 90;
  box-sizing: border-box;
  width: min(100vw, 412px);
  max-height: calc(100vh - var(--spacing-150, 24px));
  overflow-y: auto;
  padding: 22px 0 19px;
  border-radius: 28px 28px 0 0;
  background-color: #fff;
  color: #202122;
  transform: translateX(-50%);
}

/* Title 16px in from the left, close button 16px in from the right. */
.search-info-sheet__title-row {
  display: flex;
  align-items: flex-start;
  padding-inline: var(--spacing-100, 16px);
}

.search-info-sheet__title {
  flex: 1 1 auto;
  margin: 0;
  font-family: inherit;
  font-size: 22px;
  line-height: 28px;
  font-weight: 500;
}

/* 24px icon; the ::before grows the tap area without moving anything. */
.search-info-sheet__close {
  position: relative;
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
}

.search-info-sheet__close::before {
  content: '';
  position: absolute;
  inset: -12px;
}

.search-info-sheet__close img {
  display: block;
}

/* Figma's content column sits 14px from the left and 16px from the right. */
.search-info-sheet__content {
  margin-top: 17px;
  padding: 0 var(--spacing-100, 16px) 0 14px;
}

.search-info-sheet__description {
  margin: 0;
  color: #54595d;
  font-size: 14px;
  line-height: 20px;
  letter-spacing: 0.25px;
}

.search-info-sheet__question {
  display: flex;
  align-items: center;
  gap: var(--spacing-50, 8px);
  margin: var(--spacing-150, 24px) 0 0;
  font-size: 16px;
  line-height: 24px;
  font-weight: 600;
  letter-spacing: 0.15px;
}

.search-info-sheet__question-icon {
  flex-shrink: 0;
  color: #202122;
}

.search-info-sheet__example {
  margin-top: var(--spacing-100, 16px);
}

/* Two 40px pills, 9px apart, 30px under the example. */
.search-info-sheet__actions {
  display: flex;
  flex-direction: column;
  gap: 9px;
  margin-top: 30px;
  padding: 0 var(--spacing-100, 16px) 0 15px;
}

.search-info-sheet__action {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-50, 8px);
  height: 40px;
  padding: 0 14px;
  border: 0;
  border-radius: 20px;
  background-color: #f8f9fa;
  color: var(--color-progressive, #36c);
  font: inherit;
  font-size: 16px;
  line-height: 24px;
  font-weight: 500;
  cursor: pointer;
}

.search-info-sheet__action:hover {
  background-color: #eaecf0;
}

.search-info-sheet__action img {
  display: block;
  flex-shrink: 0;
}

.search-info-overlay-enter-active,
.search-info-overlay-leave-active {
  transition: opacity 250ms ease-out;
}

.search-info-overlay-enter-from,
.search-info-overlay-leave-to {
  opacity: 0;
}

/* Slides up from the bottom edge. */
.search-info-sheet-enter-active,
.search-info-sheet-leave-active {
  transition: transform 250ms ease-out;
}

.search-info-sheet-enter-from,
.search-info-sheet-leave-to {
  transform: translate(-50%, 100%);
}

@media (prefers-reduced-motion: reduce) {
  .search-info-overlay-enter-active,
  .search-info-overlay-leave-active,
  .search-info-sheet-enter-active,
  .search-info-sheet-leave-active {
    transition: none;
  }
}
</style>
