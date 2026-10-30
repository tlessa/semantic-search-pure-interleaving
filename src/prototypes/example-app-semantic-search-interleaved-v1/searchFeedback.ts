/**
 * Search feedback: when each feedback surface appears and what submitting does.
 * Logic only — the components plug into the slots marked in `index.vue` (result
 * list) and `article/index.vue` (article card + toast).
 *
 * - **List feedback**: inserted into the result list 3 s after the list renders
 *   (not 3 s after the reader stops typing), after the first result card. It sits
 *   in the list flow, so it never covers a result. A thumb opens the comment field
 *   and Submit; Submit sends.
 * - **Article feedback**: if the reader didn't answer in the list, the card appears
 *   5 s after landing in the article — only when they arrived from a result list in
 *   an eligible (semantic-search) language.
 * - **Submitting** either one shows the toast "Thanks for your feedback".
 *
 * State the article needs from the search (did the reader answer in the list?) is
 * kept at module level: the two screens are different routes.
 */
import { computed, getCurrentScope, onScopeDispose, ref, watch, type Ref } from 'vue'

import { supportsSemanticSearch } from './searchWiki'

export const LIST_FEEDBACK_DELAY_MS = 3000
export const ARTICLE_FEEDBACK_DELAY_MS = 5000
export const FEEDBACK_COMMENT_MAX_LENGTH = 230
export const FEEDBACK_TOAST_DURATION_MS = 4000

export const ARTICLE_FEEDBACK_QUESTION = 'Found what you were looking for?'
export const FEEDBACK_COMMENT_LABEL = 'Tell us more (optional)'
export const FEEDBACK_SUBMIT_LABEL = 'Submit'
export const FEEDBACK_TOAST_MESSAGE = 'Thanks for your feedback'

export type FeedbackRating = 'up' | 'down'

export interface FeedbackSubmission {
  surface: 'list' | 'article'
  rating: FeedbackRating
  comment: string
  query: string
  lang: string
  /** Article surface only: the article the card was shown on. */
  article?: string
}

/** One search, from first character to clearing the query. */
const searchSession = {
  query: '',
  lang: '',
  answeredInList: false,
}

/** Set when the reader opens a result; read once by the article screen. */
let pendingArrival: { query: string; lang: string; answeredInList: boolean } | null = null

/** No backend in a prototype: submissions are logged and kept for the session. */
export const feedbackSubmissions: FeedbackSubmission[] = []

function recordSubmission(submission: FeedbackSubmission): void {
  feedbackSubmissions.push(submission)
  console.info('[search feedback]', submission)
  showFeedbackToast()
}

/** Whether a search in `lang` is one the feedback study targets. */
export function isEligibleFeedbackLanguage(lang: string): boolean {
  return supportsSemanticSearch(lang)
}

/* ---------- Toast ---------- */

const toastMessage = ref<string | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | undefined

function showFeedbackToast(): void {
  if (toastTimer) clearTimeout(toastTimer)
  toastMessage.value = FEEDBACK_TOAST_MESSAGE
  toastTimer = setTimeout(() => {
    toastMessage.value = null
  }, FEEDBACK_TOAST_DURATION_MS)
}

/** The toast's text while it's showing, `null` otherwise. Shared by both screens. */
export function useFeedbackToast() {
  function dismiss(): void {
    if (toastTimer) clearTimeout(toastTimer)
    toastMessage.value = null
  }
  return { message: computed(() => toastMessage.value), dismiss }
}

/* ---------- Shared form state (thumbs + optional comment) ---------- */

function useFeedbackForm() {
  const rating = ref<FeedbackRating | null>(null)
  const commentText = ref('')

  /** "Tell us more": optional, capped at 230 characters. */
  const comment = computed({
    get: () => commentText.value,
    set: (value: string) => {
      commentText.value = Array.from(value).slice(0, FEEDBACK_COMMENT_MAX_LENGTH).join('')
    },
  })
  const commentRemaining = computed(
    () => FEEDBACK_COMMENT_MAX_LENGTH - Array.from(commentText.value).length,
  )
  /** A thumb is required; the comment isn't. */
  const canSubmit = computed(() => rating.value !== null)

  function setRating(value: FeedbackRating | null): void {
    rating.value = value
  }

  function reset(): void {
    rating.value = null
    commentText.value = ''
  }

  return { rating, comment, commentRemaining, canSubmit, setRating, reset }
}

function onDispose(callback: () => void): void {
  if (getCurrentScope()) onScopeDispose(callback)
}

/* ---------- Result list ---------- */

/**
 * `listRendered` is true while result cards are on screen (not the skeleton).
 * The 3 s timer starts when the list first renders and keeps running while the
 * reader refines the query; it's cancelled if the list goes away before it fires.
 * Clearing the query ends the search session.
 */
export function useListFeedback(options: {
  listRendered: Ref<boolean>
  query: Ref<string>
  lang: Ref<string>
}) {
  const visible = ref(false)
  const submitted = ref(false)
  const form = useFeedbackForm()
  let timer: ReturnType<typeof setTimeout> | undefined

  function cancelTimer(): void {
    if (timer) clearTimeout(timer)
    timer = undefined
  }

  watch(
    options.listRendered,
    (rendered) => {
      if (!rendered) {
        cancelTimer()
        visible.value = false
        return
      }
      if (visible.value || submitted.value || timer) return
      timer = setTimeout(() => {
        timer = undefined
        visible.value = true
      }, LIST_FEEDBACK_DELAY_MS)
    },
    { immediate: true },
  )

  watch(
    () => [options.query.value.trim(), options.lang.value] as const,
    ([query, lang]) => {
      if (!query) {
        // Cleared: the next character starts a new search session.
        cancelTimer()
        visible.value = false
        submitted.value = false
        form.reset()
        searchSession.answeredInList = false
      }
      searchSession.query = query
      searchSession.lang = lang
    },
    { immediate: true },
  )

  function submit(): void {
    if (!form.rating.value) return
    recordSubmission({
      surface: 'list',
      rating: form.rating.value,
      comment: form.comment.value.trim(),
      query: searchSession.query,
      lang: searchSession.lang,
    })
    searchSession.answeredInList = true
    submitted.value = true
    visible.value = false
  }

  onDispose(cancelTimer)

  return { visible, submitted, ...form, submit }
}

/** Call when the reader opens an article from the result list. */
export function recordResultListArrival(): void {
  pendingArrival = {
    query: searchSession.query,
    lang: searchSession.lang,
    answeredInList: searchSession.answeredInList,
  }
}

/* ---------- Article ---------- */

/**
 * Reads (and clears) the arrival from the result list when the article screen
 * opens, so the card is offered once per opened result: not again for articles
 * reached through links, or when the screen is reloaded.
 * Call `onLanded()` once the article is on screen at its passage.
 */
export function useArticleFeedback(article: Ref<string | undefined>) {
  const arrival = pendingArrival
  pendingArrival = null

  const eligible =
    arrival !== null && !arrival.answeredInList && isEligibleFeedbackLanguage(arrival.lang)

  const visible = ref(false)
  const form = useFeedbackForm()
  let timer: ReturnType<typeof setTimeout> | undefined
  let started = false

  function cancelTimer(): void {
    if (timer) clearTimeout(timer)
    timer = undefined
  }

  function onLanded(): void {
    if (!eligible || started) return
    started = true
    timer = setTimeout(() => {
      timer = undefined
      visible.value = true
    }, ARTICLE_FEEDBACK_DELAY_MS)
  }

  // The card belongs to the article the reader landed on.
  watch(article, (current, previous) => {
    if (previous === undefined || current === previous) return
    cancelTimer()
    visible.value = false
  })

  function submit(): void {
    if (!form.rating.value || !arrival) return
    recordSubmission({
      surface: 'article',
      rating: form.rating.value,
      comment: form.comment.value.trim(),
      query: arrival.query,
      lang: arrival.lang,
      article: article.value,
    })
    visible.value = false
  }

  function dismiss(): void {
    visible.value = false
  }

  onDispose(cancelTimer)

  return { eligible, visible, ...form, submit, dismiss, onLanded }
}
