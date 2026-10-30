<script setup lang="ts">
/**
 * Article feedback, Figma "bottom-sheet-feedback" (10066:23133): a bottom sheet with
 * the question, thumbs, "Tell us more (optional)" (230 characters) and Submit.
 * When it opens is up to searchFeedback.ts (5 s after landing, eligible readers).
 */
import { computed } from 'vue'

import thumbDownIcon from '../assets/thumb-down.svg'
import thumbUpFilledIcon from '../assets/thumb-up-filled.svg'
import thumbUpIcon from '../assets/thumb-up.svg'
import {
  ARTICLE_FEEDBACK_QUESTION,
  FEEDBACK_COMMENT_LABEL,
  FEEDBACK_COMMENT_MAX_LENGTH,
  FEEDBACK_SUBMIT_LABEL,
  type FeedbackRating,
} from '../searchFeedback'

const props = defineProps<{
  open: boolean
  rating: FeedbackRating | null
  comment: string
  /** A thumb is required before Submit sends anything. */
  canSubmit: boolean
}>()

const emit = defineEmits<{
  'update:rating': [rating: FeedbackRating]
  'update:comment': [comment: string]
  submit: []
  dismiss: []
}>()

const commentLength = computed(() => Array.from(props.comment).length)

function onSubmit(): void {
  if (props.canSubmit) emit('submit')
}
</script>

<template>
  <Teleport to="body">
    <!-- Overlay behind the sheet; tapping it closes the sheet, like the handle. -->
    <Transition name="article-feedback-overlay">
      <div
        v-if="open"
        class="article-feedback-overlay"
        aria-hidden="true"
        @click="emit('dismiss')"
      />
    </Transition>

    <Transition name="article-feedback-sheet">
      <section
        v-if="open"
        class="article-feedback-sheet semantic-search-roboto"
        aria-labelledby="article-feedback-sheet-title"
        @keydown.esc="emit('dismiss')"
      >
        <!-- The handle closes the sheet, as does the overlay (no drag gesture in the prototype). -->
        <button
          type="button"
          class="article-feedback-sheet__handle"
          aria-label="Close feedback"
          @click="emit('dismiss')"
        >
          <span class="article-feedback-sheet__bar" />
        </button>

        <form class="article-feedback-sheet__form" @submit.prevent="onSubmit">
          <h2 id="article-feedback-sheet-title" class="article-feedback-sheet__title">
            Feedback
          </h2>

          <div class="article-feedback-sheet__question-row">
            <p class="article-feedback-sheet__question">
              {{ ARTICLE_FEEDBACK_QUESTION }}
            </p>
            <div class="article-feedback-sheet__thumbs">
              <button
                type="button"
                class="article-feedback-sheet__thumb"
                aria-label="Yes"
                :aria-pressed="rating === 'up'"
                @click="emit('update:rating', 'up')"
              >
                <img :src="rating === 'up' ? thumbUpFilledIcon : thumbUpIcon" alt="" width="20" height="20">
              </button>
              <button
                type="button"
                class="article-feedback-sheet__thumb"
                aria-label="No"
                :aria-pressed="rating === 'down'"
                @click="emit('update:rating', 'down')"
              >
                <!-- No filled thumb-down in Figma: the filled thumb-up turned over. -->
                <img
                  v-if="rating === 'down'"
                  class="article-feedback-sheet__thumb-down-filled"
                  :src="thumbUpFilledIcon"
                  alt=""
                  width="20"
                  height="20"
                >
                <img v-else :src="thumbDownIcon" alt="" width="20" height="20">
              </button>
            </div>
          </div>

          <div class="article-feedback-sheet__field-group">
            <input
              class="article-feedback-sheet__field"
              type="text"
              :value="comment"
              :placeholder="FEEDBACK_COMMENT_LABEL"
              :aria-label="FEEDBACK_COMMENT_LABEL"
              :maxlength="FEEDBACK_COMMENT_MAX_LENGTH"
              @input="emit('update:comment', ($event.target as HTMLInputElement).value)"
            >
            <span class="article-feedback-sheet__counter" aria-live="polite">
              {{ commentLength }}/{{ FEEDBACK_COMMENT_MAX_LENGTH }}
            </span>
          </div>

          <!-- Looks enabled, as in Figma; without a thumb it does nothing. -->
          <button type="submit" class="article-feedback-sheet__submit" :aria-disabled="!canSubmit">
            {{ FEEDBACK_SUBMIT_LABEL }}
          </button>
        </form>
      </section>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* Material scrim (black, 32%), covering the phone column. */
.article-feedback-overlay {
  position: fixed;
  top: 0;
  bottom: 0;
  left: 50%;
  z-index: 89;
  width: min(100vw, 412px);
  background-color: rgba(0, 0, 0, 0.32);
  transform: translateX(-50%);
}

.article-feedback-overlay-enter-active,
.article-feedback-overlay-leave-active {
  transition: opacity 250ms ease-out;
}

.article-feedback-overlay-enter-from,
.article-feedback-overlay-leave-to {
  opacity: 0;
}

/* Pinned to the bottom of the phone column (MobileWrapper is at most 412px wide). */
.article-feedback-sheet {
  position: fixed;
  left: 50%;
  bottom: 0;
  z-index: 90;
  box-sizing: border-box;
  width: min(100vw, 412px);
  padding-bottom: 28px;
  border-radius: 16px 16px 0 0;
  /* The 0.5px top and side border as inset shadows, so it takes no layout space. */
  box-shadow:
    inset 0 0.5px 0 #eaecf0,
    inset 0.5px 0 0 #eaecf0,
    inset -0.5px 0 0 #eaecf0;
  background-color: #fff;
  color: #202122;
  transform: translateX(-50%);
}

/* 24px handle area with the 32 × 4 bar. */
.article-feedback-sheet__handle {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  width: 100%;
  height: 24px;
  padding: 0 0 10px;
  border: 0;
  background: none;
  cursor: pointer;
}

.article-feedback-sheet__bar {
  display: block;
  width: 32px;
  height: 4px;
  border-radius: 2px;
  background-color: #a2a9b1;
}

/* 16px under the handle; title, 24, question row, 24, field + counter, 16, Submit. */
.article-feedback-sheet__form {
  display: flex;
  flex-direction: column;
  margin-top: var(--spacing-100, 16px);
  padding-inline: var(--spacing-100, 16px);
}

.article-feedback-sheet__title {
  margin: 0;
  font-family: inherit;
  font-size: 16px;
  line-height: 24px;
  font-weight: 600;
  letter-spacing: 0.15px;
  text-align: center;
}

.article-feedback-sheet__question-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: var(--spacing-150, 24px);
}

.article-feedback-sheet__question {
  margin: 0;
  font-size: 14px;
  line-height: 20px;
  letter-spacing: 0.25px;
  white-space: nowrap;
}

.article-feedback-sheet__thumbs {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  width: 60px;
}

/* 20px like the design; the ::before grows the tap area without moving anything. */
.article-feedback-sheet__thumb {
  position: relative;
  display: block;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
}

.article-feedback-sheet__thumb::before {
  content: '';
  position: absolute;
  inset: -10px;
}

.article-feedback-sheet__thumb img {
  display: block;
}

.article-feedback-sheet__thumb-down-filled {
  transform: rotate(180deg);
}

.article-feedback-sheet__field-group {
  display: flex;
  flex-direction: column;
  margin-top: var(--spacing-150, 24px);
}

.article-feedback-sheet__field {
  box-sizing: border-box;
  width: 100%;
  height: 56px;
  padding: 0 var(--spacing-100, 16px);
  border: 1px solid #79747e;
  border-radius: 4px;
  background-color: #fff;
  color: #202122;
  font: inherit;
  font-size: 16px;
  line-height: 24px;
  letter-spacing: 0.5px;
}

.article-feedback-sheet__field::placeholder {
  color: #49454f;
  opacity: 1;
}

/* Material focus: a 2px progressive outline, drawn inside so nothing shifts. */
.article-feedback-sheet__field:focus {
  border-color: var(--border-color-progressive--focus, #36c);
  outline: 0;
  box-shadow: inset 0 0 0 1px var(--border-color-progressive--focus, #36c);
}

.article-feedback-sheet__counter {
  padding: var(--spacing-25, 4px) var(--spacing-100, 16px) 0;
  color: #49454f;
  font-size: 12px;
  line-height: 16px;
  letter-spacing: 0.4px;
  text-align: right;
}

.article-feedback-sheet__submit {
  height: 40px;
  margin-top: var(--spacing-100, 16px);
  padding: 0 var(--spacing-150, 24px);
  border: 0;
  border-radius: var(--border-radius-pill, 9999px);
  background-color: var(--background-color-progressive, #36c);
  color: var(--color-inverted-fixed, #fff);
  font: inherit;
  font-size: 14px;
  line-height: 20px;
  font-weight: 500;
  letter-spacing: 0.1px;
  cursor: pointer;
}

.article-feedback-sheet__submit:hover {
  background-color: var(--background-color-progressive--hover, #3056a9);
}

.article-feedback-sheet__submit:active {
  background-color: var(--background-color-progressive--active, #233566);
}

.article-feedback-sheet__submit[aria-disabled='true'] {
  cursor: default;
}

/* Slides up from the bottom edge. */
.article-feedback-sheet-enter-active,
.article-feedback-sheet-leave-active {
  transition: transform 250ms ease-out;
}

.article-feedback-sheet-enter-from,
.article-feedback-sheet-leave-to {
  transform: translate(-50%, 100%);
}

@media (prefers-reduced-motion: reduce) {
  .article-feedback-overlay-enter-active,
  .article-feedback-overlay-leave-active,
  .article-feedback-sheet-enter-active,
  .article-feedback-sheet-leave-active {
    transition: none;
  }
}
</style>
