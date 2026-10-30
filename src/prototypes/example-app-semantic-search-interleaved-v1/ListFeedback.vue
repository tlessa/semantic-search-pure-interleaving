<script setup lang="ts">
/**
 * List feedback, Figma "cards feedback component".
 * - Compact (10059:21475): the question and two thumbs.
 * - Expanded (10066:22855): a thumb fills in and the card opens, with an animation,
 *   onto "Tell us more (optional)" (230 characters) and Submit.
 * State lives in searchFeedback.ts; this only renders it.
 */
import { computed } from 'vue'

import thumbDownIcon from './assets/thumb-down.svg'
import thumbUpFilledIcon from './assets/thumb-up-filled.svg'
import thumbUpIcon from './assets/thumb-up.svg'
import {
  ARTICLE_FEEDBACK_QUESTION,
  FEEDBACK_COMMENT_LABEL,
  FEEDBACK_COMMENT_MAX_LENGTH,
  FEEDBACK_SUBMIT_LABEL,
  type FeedbackRating,
} from './searchFeedback'

const props = defineProps<{
  rating: FeedbackRating | null
  comment: string
}>()

const emit = defineEmits<{
  'update:rating': [rating: FeedbackRating]
  'update:comment': [comment: string]
  submit: []
}>()

const expanded = computed(() => props.rating !== null)
const commentLength = computed(() => Array.from(props.comment).length)
</script>

<template>
  <div
    class="list-feedback"
    :class="{ 'list-feedback--expanded': expanded }"
    role="group"
    :aria-label="ARTICLE_FEEDBACK_QUESTION"
  >
    <div class="list-feedback__header">
      <p class="list-feedback__question">
        {{ ARTICLE_FEEDBACK_QUESTION }}
      </p>
      <div class="list-feedback__thumbs">
        <button
          type="button"
          class="list-feedback__thumb"
          aria-label="Yes"
          :aria-pressed="rating === 'up'"
          @click="emit('update:rating', 'up')"
        >
          <img :src="rating === 'up' ? thumbUpFilledIcon : thumbUpIcon" alt="" width="20" height="20">
        </button>
        <button
          type="button"
          class="list-feedback__thumb"
          aria-label="No"
          :aria-pressed="rating === 'down'"
          @click="emit('update:rating', 'down')"
        >
          <!-- Figma has no filled thumb-down: it's the filled thumb-up turned over. -->
          <img
            v-if="rating === 'down'"
            class="list-feedback__thumb-down-filled"
            :src="thumbUpFilledIcon"
            alt=""
            width="20"
            height="20"
          >
          <img v-else :src="thumbDownIcon" alt="" width="20" height="20">
        </button>
      </div>
    </div>

    <!-- Collapsed rows take no height; `inert` keeps them out of tab order meanwhile. -->
    <div class="list-feedback__expand" :inert="!expanded">
      <form class="list-feedback__form" @submit.prevent="emit('submit')">
        <input
          class="list-feedback__field"
          type="text"
          :value="comment"
          :placeholder="FEEDBACK_COMMENT_LABEL"
          :aria-label="FEEDBACK_COMMENT_LABEL"
          :maxlength="FEEDBACK_COMMENT_MAX_LENGTH"
          @input="emit('update:comment', ($event.target as HTMLInputElement).value)"
        >
        <span class="list-feedback__counter" aria-live="polite">
          {{ commentLength }}/{{ FEEDBACK_COMMENT_MAX_LENGTH }}
        </span>
        <button type="submit" class="list-feedback__submit">
          {{ FEEDBACK_SUBMIT_LABEL }}
        </button>
      </form>
    </div>
  </div>
</template>

<style scoped>
.list-feedback {
  display: flex;
  flex-direction: column;
  padding: var(--spacing-100, 16px);
  border-radius: 16px;
  background-color: var(--background-color-interactive, #eaecf0);
}

.list-feedback__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.list-feedback__question {
  margin: 0;
  color: var(--color-base, #202122);
  font-size: 14px;
  line-height: 20px;
  letter-spacing: 0.25px;
  white-space: nowrap;
}

.list-feedback__thumbs {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  width: 60px;
}

/* 20px like the design; the ::before grows the tap area without moving anything. */
.list-feedback__thumb {
  position: relative;
  display: block;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
}

.list-feedback__thumb::before {
  content: '';
  position: absolute;
  inset: -10px;
}

.list-feedback__thumb img {
  display: block;
}

.list-feedback__thumb-down-filled {
  transform: rotate(180deg);
}

/* Expands from 0 to its content height: grid rows animate where `height: auto` can't. */
.list-feedback__expand {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  transition:
    grid-template-rows 250ms ease-out,
    opacity 200ms ease-out;
}

.list-feedback--expanded .list-feedback__expand {
  grid-template-rows: 1fr;
  opacity: 1;
}

/* 24px under the question, 56px field, counter, 12px, 40px button: 204px card. */
.list-feedback__form {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.list-feedback__field {
  box-sizing: border-box;
  width: 100%;
  height: 56px;
  margin-top: var(--spacing-150, 24px);
  padding: 0 var(--spacing-100, 16px);
  border: 1px solid #79747e;
  border-radius: 4px;
  background-color: var(--background-color-base, #fff);
  color: var(--color-base, #202122);
  font: inherit;
  font-size: 16px;
  line-height: 24px;
  letter-spacing: 0.5px;
}

.list-feedback__field::placeholder {
  color: #49454f;
  opacity: 1;
}

/* Material focus: a 2px progressive outline, drawn inside so nothing shifts. */
.list-feedback__field:focus {
  border-color: var(--border-color-progressive--focus, #36c);
  outline: 0;
  box-shadow: inset 0 0 0 1px var(--border-color-progressive--focus, #36c);
}

.list-feedback__counter {
  padding: var(--spacing-25, 4px) var(--spacing-100, 16px) 0;
  color: #49454f;
  font-size: 12px;
  line-height: 16px;
  letter-spacing: 0.4px;
  text-align: right;
}

.list-feedback__submit {
  height: 40px;
  margin-top: var(--spacing-75, 12px);
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

.list-feedback__submit:hover {
  background-color: var(--background-color-progressive--hover, #3056a9);
}

.list-feedback__submit:active {
  background-color: var(--background-color-progressive--active, #233566);
}

@media (prefers-reduced-motion: reduce) {
  .list-feedback__expand {
    transition: none;
  }
}
</style>
