<script setup lang="ts">
import { cdxIconSearch } from '@wikimedia/codex-icons'

definePage({
  meta: {
    title: 'Semantic Search Routing and Interleaving V2',
    category: 'example',
    platform: 'app',
    order: 3,
    icon: cdxIconSearch,
  },
})

import { computed, defineComponent, h, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  CdxButton,
  CdxIcon,
  CdxInfoChip,
  CdxMenuButton,
  CdxSearchInput,
  CdxTab,
  CdxTabs,
} from '@wikimedia/codex'
import { cdxIconClose, cdxIconTrash } from '@wikimedia/codex-icons'

import AppChromeHeader from '@/components/app/AppChromeHeader.vue'
import type { AppHeaderItem } from '@/components/app/AppChromeHeader.vue'
import MobileWrapper from '@/components/MobileWrapper.vue'
import { useIsIos } from '@/composables/useAppPlatform'
import { wikiHostFromLang } from '@/config'

import contributorsIcon from './assets/contributors.svg'
import experimentIcon from './assets/experiment.svg'
import infoIcon from './assets/info.svg'
import infoExampleMoon from './assets/info-example-moon.png'
import emptyMagnifier from './assets/empty-magnifier.svg'
import emptyPage from './assets/empty-page.svg'
import emptyPageCorner from './assets/empty-page-corner.svg'
import emptyWordmark from './assets/empty-wordmark.svg'
import referencesIcon from './assets/references.svg'
import sectionArrowIcon from './assets/subdirectory-arrow-right.svg'
import thumbDownIcon from './assets/thumb-down.svg'
import thumbUpFilledIcon from './assets/thumb-up-filled.svg'
import thumbUpIcon from './assets/thumb-up.svg'

import {
  DEFAULT_SEARCH_LANGUAGES,
  MORE_SEARCH_LANGUAGES,
  minQueryLength,
  type SearchLanguageOption,
} from './searchLanguages'
import { interleaveResults } from './interleave'
import {
  CLASSIFIER_VERSION,
  countWords,
  routeQuery,
  routeReason,
  type SearchRoute,
} from './routeQuery'
import TestPanel from './TestPanel.vue'
import { testSettings, underTestConditions } from './testPanel'
import {
  SEMANTIC_TIMEOUT_MS,
  supportsSemanticSearch,
  searchSemantic,
  searchWiki,
  type WikiSearchResult,
} from './searchWiki'
import { useRecentSearches } from './useRecentSearches'
import FeedbackToast from './FeedbackToast.vue'
import ResultContextMenu, { type ResultMenuAction } from './ResultContextMenu.vue'
import SearchInfoSheet from './SearchInfoSheet.vue'
import { useResultSignals } from './useResultSignals'
import { searchWithinArticles } from './searchSettings'
import { useLongPress } from './useLongPress'
import { useVisualViewport } from './useVisualViewport'
import PlainSearch from './PlainSearch.vue'
import './roboto.css'

const router = useRouter()
const route = useRoute()

// The test panel (desktop) holds these; `?debug=1` and `?arm=control` still set them.
if (route.query.debug === '1') testSettings.showLabels = true
if (route.query.arm === 'control') testSettings.arm = 'control'

/** Labels each result with the retriever that placed it. Readers never see this. */
const debug = computed(() => testSettings.showLabels)
/**
 * Control: today's search (lexical, as you type) for comparison. The route the query
 * would have taken is still logged.
 */
const control = computed(() => testSettings.arm === 'control')
const isIos = useIsIos()
/** The visible area: the screen pins itself to it (iOS search bar on top of the keyboard). */
const viewport = useVisualViewport()
/** The results area: the only part of the screen that scrolls. */
const resultsScroller = ref<HTMLElement | null>(null)

const query = ref('')
const langTabs = ref<SearchLanguageOption[]>([...DEFAULT_SEARCH_LANGUAGES])
const activeLang = ref(langTabs.value[0].code)
const pendingMoreSelection = ref<string | null>(null)

const results = ref<WikiSearchResult[]>([])
const searchError = ref<string | null>(null)
/** True from the moment a valid query is typed until its results land. */
const searching = ref(false)

/** Code points, so a CJK or emoji character counts as one. */
function queryLength(value: string): number {
  return Array.from(value.trim()).length
}

/**
 * The route for the query as it is now: decided on the same trimmed text that is sent
 * to retrieval, every time the query changes. Control and other wikis: lexical.
 */
const currentRoute = computed<SearchRoute>(() => {
  if (!isRouted(activeLang.value)) return 'lexical'
  // The test panel can force one route for every query.
  return testSettings.route === 'auto' ? routeQuery(query.value.trim()) : testSettings.route
})

/** Lexical results start from the first letter; other routes keep the minimum length. */
const belowMinimum = computed(
  () =>
    queryLength(query.value) <
    (currentRoute.value === 'lexical' ? 1 : minQueryLength(activeLang.value)),
)

/**
 * Semantic and interleaved routes take longer: from the pause (or submit) until their
 * list lands, the skeleton replaces the as-you-type list. Kept through further typing
 * so it doesn't flicker; cleared when the query routes back to lexical.
 */
const retrieving = ref(false)

/**
 * Skeleton for semantic and interleaved routes only: while their list is retrieved,
 * or while nothing is on screen yet. Lexical queries behave as today: no skeleton.
 */
const showSkeleton = computed(
  () =>
    currentRoute.value !== 'lexical' &&
    !searchError.value &&
    (retrieving.value ||
      (!results.value.length && (belowMinimum.value || searching.value))),
)


/** The ⓘ next to the Beta badge opens the "Search within articles" sheet. */
const infoOpen = ref(false)

/** "Turn off feature" in the info sheet: Settings, opened at the Search toggle. */
function openSettings(): void {
  infoOpen.value = false
  router.push({
    path: `${route.path.replace(/\/$/, '')}/settings`,
    query: debug.value ? { debug: '1' } : {},
    hash: '#search-within-articles',
  })
}

const { recentSearches, addRecentSearch, clearRecentSearches } = useRecentSearches()
const { signalsFor } = useResultSignals(results, activeLang)

let searchAbort: AbortController | null = null
let debounceHandle: ReturnType<typeof setTimeout> | undefined

/** Semantic and interleaved routes: results wait until the reader pauses (or submits). */
const pauseMs = computed(() => Math.max(0, Number(testSettings.pauseMs) || 0))
/** Semantic and interleaved lists are cut to the same fixed length (US-3). */
const listLength = computed(() => Math.max(1, Number(testSettings.listLength) || 1))

/** The retrievers, under the test panel's delay and failure settings. */
function lexicalSearch(text: string, options: { signal: AbortSignal; lang: string }) {
  return underTestConditions('lexical', () => searchWiki(text, options), options.signal)
}

function semanticSearch(text: string, options: { signal: AbortSignal; lang: string }) {
  return underTestConditions('semantic', () => searchSemantic(text, options), options.signal)
}

type SemanticOutcome =
  | { status: 'ok'; results: WikiSearchResult[] }
  | { status: 'timeout' | 'error' }

/**
 * US-6: semantic results within SEMANTIC_TIMEOUT_MS. Errors (rate limits, an
 * unavailable backend) and late answers come back as a status, never thrown, so the
 * caller falls back to lexical with no error. A late answer is dropped: it never
 * reaches, or reorders, a list on screen.
 */
async function semanticWithinTimeout(
  text: string,
  options: { signal: AbortSignal; lang: string },
): Promise<SemanticOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<SemanticOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ status: 'timeout' }), SEMANTIC_TIMEOUT_MS)
  })
  const answer = semanticSearch(text, options).then(
    (results): SemanticOutcome => ({ status: 'ok', results }),
    (): SemanticOutcome => ({ status: 'error' }),
  )
  try {
    return await Promise.race([answer, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/** Why a semantic or interleaved list fell back (US-6), for the log. */
type Fallback = 'timeout' | 'error' | 'empty'

function fallbackFor(outcome: SemanticOutcome): Fallback | null {
  if (outcome.status !== 'ok') return outcome.status
  return outcome.results.length ? null : 'empty'
}

/**
 * `lang:query` of the list on screen. Once rendered, a list changes only when the
 * query does: a submit or a trailing space doesn't redraw it.
 */
let renderedKey: string | null = null

/** The query of the list on screen, `null` for none (the test panel waits on it). */
const listQuery = ref<string | null>(null)

/** Empty state: both retrievers answered with nothing (an error shows instead of it). */
const showEmptyState = computed(
  () =>
    !!query.value.trim() &&
    !results.value.length &&
    !showSkeleton.value &&
    !searchError.value &&
    listQuery.value === query.value.trim(),
)

function setResults(
  list: WikiSearchResult[],
  key: string | null = null,
  text: string | null = null,
): void {
  results.value = list
  renderedKey = key
  listQuery.value = text
}

/**
 * The list on screen mixes semantic and lexical cards (the interleaved route). Matches
 * aren't bolded there: only semantic passages have them highlighted as an answer, so
 * bold would reveal which retriever each card came from.
 */
const listIsInterleaved = computed(
  () =>
    results.value.some((r) => r.source === 'semantic') &&
    results.value.some((r) => r.source === 'lexical'),
)

function normalizeTitle(value: string): string {
  return value.replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLocaleLowerCase()
}

/** Whether lexical search found an article titled exactly as the query (EF-3). */
function hasExactTitleMatch(lexical: WikiSearchResult[], query: string): boolean {
  const wanted = normalizeTitle(query)
  return lexical.some((result) => normalizeTitle(result.title) === wanted)
}

/** English in the treatment arm is routed; other wikis and control get today's search. */
function isRouted(lang: string): boolean {
  return !control.value && supportsSemanticSearch(lang)
}

type SearchTrigger = 'typing' | 'pause' | 'submit' | 'test-panel'

interface RouteLogEntry {
  query: string
  lang: string
  served: SearchRoute
  trigger: SearchTrigger
  count: number
  /** Semantic route only: from the lexical search run in the background. */
  exactTitleMatch?: boolean | null
  /** Semantic and interleaved routes: why semantic results are missing, if they are. */
  fallback?: Fallback | null
}

/** No backend in a prototype: lists log their route (EF-3), control included. */
function logRoute(entry: RouteLogEntry): void {
  // English only: the classifier's route, also for control (what it would have been).
  const classified = supportsSemanticSearch(entry.lang)
  const logged = {
    ...entry,
    arm: control.value ? 'control' : 'treatment',
    route: classified ? routeQuery(entry.query) : null,
    reason: classified ? routeReason(entry.query) : null,
    classifierVersion: CLASSIFIER_VERSION,
    // Only when the test panel forces a route.
    ...(testSettings.route !== 'auto' && !control.value ? { forcedRoute: testSettings.route } : {}),
  }
  console.info('[search route]', logged)
}

/*
 * As-you-type lists are logged once per query attempt, not per keystroke. A stand-in
 * for Shay's query-attempt rules: the list on screen is logged when the reader stops
 * typing (the pause) or opens a result; another keystroke or a submit replaces it.
 */
let pendingTypingLog: RouteLogEntry | null = null
let typingLogTimer: ReturnType<typeof setTimeout> | undefined

function queueTypingLog(entry: RouteLogEntry): void {
  clearTimeout(typingLogTimer)
  pendingTypingLog = entry
  typingLogTimer = setTimeout(flushTypingLog, pauseMs.value)
}

function flushTypingLog(): void {
  clearTimeout(typingLogTimer)
  if (pendingTypingLog) logRoute(pendingTypingLog)
  pendingTypingLog = null
}

function dropTypingLog(): void {
  clearTimeout(typingLogTimer)
  pendingTypingLog = null
}

onBeforeUnmount(() => clearTimeout(typingLogTimer))

const moreLanguageMenuItems = computed(() =>
  MORE_SEARCH_LANGUAGES.filter((lang) => !langTabs.value.some((tab) => tab.code === lang.code)).map(
    (lang) => ({ value: lang.code, label: `${lang.code.toUpperCase()} ${lang.label}` }),
  ),
)

function goBack(): void {
  router.back()
}

const SearchInputField = defineComponent({
  name: 'TemplateAppSearchInput',
  setup() {
    return () =>
      h(CdxSearchInput, {
        class: 'template-app-search__input',
        modelValue: query.value,
        'onUpdate:modelValue': (value: string) => {
          query.value = value
        },
        placeholder: 'Search Wikipedia…',
        clearable: true,
        onSubmitClick: onSubmit,
      })
  },
})

const searchHeaderLeft: AppHeaderItem[] = [
  { type: 'button', icon: 'arrow-previous', label: 'Back', onClick: goBack },
  { type: 'component', component: SearchInputField },
]

function onAddLanguage(value: string | number | null): void {
  if (typeof value !== 'string') return

  const lang = MORE_SEARCH_LANGUAGES.find((item) => item.code === value)
  if (!lang) return

  langTabs.value = [...langTabs.value, lang]
  activeLang.value = lang.code
  pendingMoreSelection.value = null
}

async function runSearch(trigger: SearchTrigger): Promise<void> {
  const trimmed = query.value.trim()
  if (belowMinimum.value) return

  const key = `${activeLang.value}:${trimmed}`
  if (key === renderedKey) {
    searching.value = false
    return
  }

  searchAbort?.abort()
  searchAbort = new AbortController()
  const { signal } = searchAbort

  searchError.value = null
  if (currentRoute.value !== 'lexical') retrieving.value = true

  try {
    const lang = activeLang.value
    const options = { signal, lang }
    const searchRoute = currentRoute.value
    let served = searchRoute
    let list: WikiSearchResult[]
    let fallback: Fallback | null = null
    /** Semantic route: lexical runs alongside, never shown next to semantic results. */
    let backgroundLexical: Promise<WikiSearchResult[]> | null = null

    if (searchRoute === 'lexical') {
      list = await lexicalSearch(trimmed, options)
    } else if (searchRoute === 'semantic') {
      backgroundLexical = lexicalSearch(trimmed, options)
      backgroundLexical.catch(() => {})
      const semantic = await semanticWithinTimeout(trimmed, options)
      fallback = fallbackFor(semantic)
      if (semantic.status === 'ok' && semantic.results.length) {
        list = semantic.results.slice(0, listLength.value)
      } else {
        // US-6: a timeout, an error or no results show the lexical list, no error.
        // If lexical fails too, its error reaches the error state below.
        if (signal.aborted) return
        list = await backgroundLexical
        served = 'lexical'
      }
    } else {
      const [lexical, semantic] = await Promise.all([
        lexicalSearch(trimmed, options).then(
          (results) => ({ results, error: null as unknown }),
          (error: unknown) => ({ results: [] as WikiSearchResult[], error }),
        ),
        semanticWithinTimeout(trimmed, options),
      ])
      fallback = fallbackFor(semantic)
      const semanticResults = semantic.status === 'ok' ? semantic.results : []
      // Lexical failed and semantic has nothing to show: the error state.
      if (lexical.error && !semanticResults.length) throw lexical.error
      // US-6: one side missing shows the other alone (no lexical: semantic only).
      list = interleaveResults(lexical.results, semanticResults).slice(0, listLength.value)
      if (!semanticResults.length) served = 'lexical'
      else if (!lexical.results.length) served = 'semantic'
    }

    if (signal.aborted) return
    // One update: the routed or merged list replaces the as-you-type list.
    setResults(list, key, trimmed)
    const entry: RouteLogEntry = {
      query: trimmed,
      lang,
      served,
      trigger,
      count: list.length,
      ...(searchRoute === 'lexical' ? {} : { fallback }),
    }
    if (backgroundLexical) {
      // Logged once the background lexical search answers (null if it failed).
      void backgroundLexical
        .then((lexical) => hasExactTitleMatch(lexical, trimmed), () => null)
        .then((exactTitleMatch) => logRoute({ ...entry, exactTitleMatch }))
    } else if (trigger === 'typing') {
      queueTypingLog(entry)
    } else {
      logRoute(entry)
    }
    scrollResultsToTop()
  } catch (err) {
    if (signal.aborted) return
    searchError.value = err instanceof Error ? err.message : 'Search failed.'
    setResults([])
  } finally {
    if (!signal.aborted) {
      searching.value = false
      retrieving.value = false
    }
  }
}

/**
 * New results always start at the top. Only the results area scrolls (the page is
 * pinned to the visible area), so this never fights mobile Safari's own scrolling.
 */
function scrollResultsToTop(): void {
  resultsScroller.value?.scrollTo({ top: 0 })
}

watch([query, activeLang], ([, lang], [, prevLang]) => {
  if (debounceHandle) clearTimeout(debounceHandle)
  dropTypingLog()
  scrollResultsToTop()

  // Results from another wiki, or for a too-short query, are never shown.
  if (lang !== prevLang || belowMinimum.value) {
    setResults([])
    searchError.value = null
  }

  // A query that now routes to lexical (e.g. deleted back from three words to two)
  // never keeps semantic results on screen.
  if (currentRoute.value === 'lexical' && results.value.some((r) => r.source === 'semantic')) {
    setResults(results.value.filter((r) => r.source === 'lexical'))
  }

  if (currentRoute.value === 'lexical') retrieving.value = false

  // Empty or below the minimum: request nothing, and drop any request in flight.
  if (belowMinimum.value) {
    searchAbort?.abort()
    searching.value = false
    retrieving.value = false
    return
  }

  searching.value = true

  // Lexical: as today, every keystroke requests at once (no debounce); the new
  // request cancels the one in flight.
  if (currentRoute.value === 'lexical') {
    void runSearch('typing')
    return
  }

  // Semantic and interleaved: nothing updates until a pause or a submit, so drop the
  // as-you-type request in flight; the current list stays up.
  searchAbort?.abort()
  debounceHandle = setTimeout(() => {
    void runSearch('pause')
  }, pauseMs.value)
})

function onSubmit(): void {
  if (debounceHandle) clearTimeout(debounceHandle)
  // The as-you-type list the reader submitted on counts as the attempt's list.
  flushTypingLog()
  addRecentSearch(query.value)
  void runSearch('submit')
}

function selectRecentSearch(term: string): void {
  query.value = term
}

/** Test panel: as if typed. The same query again runs again, for a fresh list. */
function setQueryFromPanel(text: string): void {
  if (query.value !== text) {
    query.value = text
    return
  }
  if (debounceHandle) clearTimeout(debounceHandle)
  dropTypingLog()
  renderedKey = null
  searching.value = true
  void runSearch('test-panel')
}

/** Semantic results land on the passage that answered the query (see article/). */
function articleLocation(result: WikiSearchResult) {
  return {
    path: `${route.path.replace(/\/$/, '')}/article`,
    query: {
      article: result.title,
      lang: activeLang.value,
      ...(result.answerText ? { answer: result.answerText } : {}),
      ...(result.sectionTitle ? { section: result.sectionTitle } : {}),
      ...(debug.value ? { debug: '1' } : {}),
    },
  }
}

function selectResult(result: WikiSearchResult): void {
  flushTypingLog()
  addRecentSearch(query.value)
  router.push(articleLocation(result))
}

/* ---------- Long-press menu on a result card ---------- */

/* ---------- "Is this result relevant?" on each card ---------- */

type RelevanceRating = 'up' | 'down'

/** Per result, for the current query; a new query starts with none. */
const relevance = reactive<Record<string, RelevanceRating>>({})

function resultKey(result: WikiSearchResult): string {
  return `${result.source}-${result.pageid}`
}

/** A thumb fills in; the other thumb switches; the same thumb again clears it. */
function rateResult(result: WikiSearchResult, rating: RelevanceRating): void {
  const key = resultKey(result)
  if (relevance[key] === rating) {
    delete relevance[key]
    return
  }
  relevance[key] = rating
  showToast('Thanks for your feedback')
  // No backend in a prototype: logged.
  console.info('[result relevance]', {
    query: query.value.trim(),
    lang: activeLang.value,
    title: result.title,
    source: result.source,
    rating,
  })
}

watch([() => query.value.trim(), activeLang], () => {
  for (const key of Object.keys(relevance)) delete relevance[key]
})

/**
 * Figma "Snackbar" (10066:23469), shown 4 s: each time a thumb fills in, and when a
 * search fails (in place of an error message on the screen).
 */
const toastMessage = ref<string | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | undefined

function showToast(message: string): void {
  clearTimeout(toastTimer)
  toastMessage.value = message
  toastTimer = setTimeout(() => {
    toastMessage.value = null
  }, 4000)
}

onBeforeUnmount(() => clearTimeout(toastTimer))

/** The error state: the search failed; the details stay in `searchError` for debugging. */
watch(searchError, (error) => {
  if (error) showToast('There was an error, please try again')
})

const resultMenu = reactive({
  open: false,
  x: 0,
  y: 0,
  result: null as WikiSearchResult | null,
  /** The card to refocus when the menu closes. */
  returnFocus: null as HTMLElement | null,
})

function openResultMenu(result: WikiSearchResult, point: { x: number; y: number }, card?: HTMLElement): void {
  if (resultMenu.open) return
  Object.assign(resultMenu, { open: true, ...point, result, returnFocus: card ?? null })
}

function closeResultMenu(): void {
  resultMenu.open = false
  resultMenu.returnFocus?.focus()
}

const longPress = useLongPress<WikiSearchResult>((result, point) => openResultMenu(result, point))

function onResultClick(result: WikiSearchResult): void {
  // The finger lifting after a long press isn't a tap.
  if (longPress.consumeClick()) return
  selectResult(result)
}

/** Right-click, Android's own long-press event, or the keyboard menu key. */
function onResultContextMenu(result: WikiSearchResult, event: MouseEvent): void {
  longPress.cancel()
  const card = event.currentTarget as HTMLElement
  // From the keyboard there's no pointer: open at the card's top-left.
  const fromKeyboard = event.clientX === 0 && event.clientY === 0
  const rect = card.getBoundingClientRect()
  const point = fromKeyboard
    ? { x: rect.left + 16, y: rect.top + 16 }
    : { x: event.clientX, y: event.clientY }
  openResultMenu(result, point, card)
}

function wikiUrl(result: WikiSearchResult): string {
  return `https://${wikiHostFromLang(activeLang.value)}/wiki/${encodeURIComponent(result.title.replace(/ /g, '_'))}`
}

function copyText(text: string): void {
  navigator.clipboard?.writeText(text).catch(() => {})
}

function onResultMenuSelect(action: ResultMenuAction): void {
  const result = resultMenu.result
  closeResultMenu()
  if (!result) return

  switch (action) {
    case 'open':
      selectResult(result)
      break
    case 'open-new-tab':
      addRecentSearch(query.value)
      window.open(router.resolve(articleLocation(result)).href, '_blank', 'noopener')
      break
    case 'share':
      // The phone's share sheet where there is one; otherwise copy the link.
      if (navigator.share) navigator.share({ title: result.title, url: wikiUrl(result) }).catch(() => {})
      else copyText(wikiUrl(result))
      break
    case 'copy':
      copyText(wikiUrl(result))
      break
    case 'save':
      // No saved pages in the prototype: the menu just closes.
      break
  }
}
</script>

<template>
  <!-- Settings → "Search within articles" off: the plain search, lexical only. -->
  <PlainSearch v-if="!searchWithinArticles" />
  <MobileWrapper v-else>
    <div
      class="template-app-search-shell semantic-search-roboto"
      :style="{ '--viewport-top': `${viewport.top}px`, '--viewport-height': `${viewport.height}px` }"
    >
      <AppChromeHeader v-if="!isIos" :left="searchHeaderLeft" :right="[]" />

      <div
        ref="resultsScroller"
        class="template-app-search"
        :class="{ 'template-app-search--empty': showEmptyState }"
      >
        <div class="template-app-search__lang-row">
          <CdxTabs v-model:active="activeLang" class="template-app-search__tabs">
            <CdxTab
              v-for="tab in langTabs"
              :key="tab.code"
              :name="tab.code"
              :label="`${tab.code.toUpperCase()} ${tab.label}`"
            />
          </CdxTabs>

          <CdxMenuButton
            v-if="moreLanguageMenuItems.length"
            v-model:selected="pendingMoreSelection"
            class="template-app-search__more"
            weight="quiet"
            :menu-items="moreLanguageMenuItems"
            @update:selected="onAddLanguage"
          >
            more
          </CdxMenuButton>
        </div>

        <!-- Only while searching: over the skeleton and the results, not recent searches. -->
        <div
          v-if="query.trim() && (showSkeleton || results.length || showEmptyState)"
          class="template-app-search__beta-row"
        >
          <!-- The list on screen (not the skeleton). -->
          <span
            v-if="results.length && !showSkeleton"
            class="template-app-search__result-count"
          >
            {{ results.length }} {{ results.length === 1 ? 'result' : 'results' }}
          </span>
          <span class="template-app-search__beta-badge">
            <img :src="experimentIcon" alt="" width="16" height="16">
            Beta
          </span>
          <button
            type="button"
            class="template-app-search__info"
            aria-label="About this search"
            aria-haspopup="dialog"
            @click="infoOpen = true"
          >
            <span class="template-app-search__info-state">
              <img :src="infoIcon" alt="" width="20" height="20">
            </span>
          </button>
        </div>

        <template v-if="!query.trim()">
          <div class="template-app-search__section-header">
            <h2 class="template-app-search__section-title">Recent searches</h2>
            <CdxButton
              v-if="recentSearches.length"
              weight="quiet"
              aria-label="Clear recent searches"
              @click="clearRecentSearches"
            >
              <CdxIcon :icon="cdxIconTrash" />
            </CdxButton>
          </div>

          <ul v-if="recentSearches.length" class="template-app-search__recent-list">
            <li v-for="item in recentSearches" :key="item">
              <button
                type="button"
                class="template-app-search__recent-item"
                @click="selectRecentSearch(item)"
              >
                {{ item }}
              </button>
            </li>
          </ul>
          <p v-else class="template-app-search__status">No recent searches.</p>
        </template>

        <template v-else>

          <!-- Built from the card's own classes so it has the card's size: no jump on load. -->
          <ul v-if="showSkeleton" class="template-app-search__results" aria-hidden="true">
            <li v-for="n in 3" :key="n">
              <div class="template-app-search__result template-app-search__skeleton">
                <span class="template-app-search__result-body">
                  <span class="template-app-search__result-header">
                    <span class="template-app-search__result-text">
                      <span class="template-app-search__skeleton-bar template-app-search__skeleton-bar--title" />
                      <span class="template-app-search__skeleton-bar template-app-search__skeleton-bar--small template-app-search__skeleton-bar--short" />
                      <span class="template-app-search__result-section">
                        <span class="template-app-search__skeleton-bar template-app-search__skeleton-bar--small template-app-search__skeleton-bar--section" />
                      </span>
                    </span>
                    <span class="template-app-search__skeleton-thumb" />
                  </span>
                  <span class="template-app-search__skeleton-passage">
                    <span
                      v-for="line in 8"
                      :key="line"
                      class="template-app-search__skeleton-bar template-app-search__skeleton-bar--body"
                      :class="{ 'template-app-search__skeleton-bar--short': line === 8 }"
                    />
                  </span>
                </span>

                <span class="template-app-search__result-read">
                  <span class="template-app-search__skeleton-bar template-app-search__skeleton-bar--small template-app-search__skeleton-bar--read" />
                </span>

                <span class="template-app-search__result-attribution">
                  <span class="template-app-search__result-signals">
                    <span class="template-app-search__skeleton-bar template-app-search__skeleton-bar--small template-app-search__skeleton-bar--signal" />
                    <span class="template-app-search__skeleton-bar template-app-search__skeleton-bar--small template-app-search__skeleton-bar--signal" />
                  </span>
                </span>
              </div>
              <div class="template-app-search__result-rating">
                <span class="template-app-search__skeleton-bar template-app-search__skeleton-bar--small template-app-search__skeleton-bar--rating" />
              </div>
            </li>
          </ul>

          <ul
            v-else-if="results.length"
            class="template-app-search__results"
            :class="{ 'template-app-search__results--interleaved': listIsInterleaved }"
          >
            <template v-for="result in results" :key="`${result.source}-${result.pageid}`">
              <li>
                <button
                  type="button"
                  class="template-app-search__result"
                  aria-haspopup="menu"
                  @click="onResultClick(result)"
                  @pointerdown="longPress.onPointerDown(result, $event)"
                  @pointermove="longPress.onPointerMove"
                  @pointerup="longPress.onPointerUp"
                  @pointercancel="longPress.onPointerCancel"
                  @contextmenu.prevent="onResultContextMenu(result, $event)"
                >
                  <span class="template-app-search__result-body">
                    <span class="template-app-search__result-header">
                      <span class="template-app-search__result-text">
                        <CdxInfoChip v-if="debug" class="template-app-search__result-debug">
                          {{ result.source === 'semantic' ? 'Semantic' : 'Lexical' }}
                        </CdxInfoChip>
                        <!-- eslint-disable-next-line vue/no-v-html -->
                        <span class="template-app-search__result-title" v-html="result.titleHtml" />
                        <!-- Redirects: like the Android app, in place of the short description. -->
                        <span
                          v-if="result.redirectedFrom"
                          class="template-app-search__result-description"
                        >
                          <span aria-hidden="true">»</span> Redirected from “{{ result.redirectedFrom }}”
                        </span>
                        <span
                          v-else-if="result.description"
                          class="template-app-search__result-description"
                        >
                          {{ result.description }}
                        </span>
                        <!-- Where the passage comes from: its section, or "Lead" (lexical cards'
                             first paragraph, and semantic passages from before the first heading). -->
                        <span
                          v-if="result.sectionTitle || result.passageHtml"
                          class="template-app-search__result-section"
                        >
                          <span class="template-app-search__icon" :style="{ '--icon': `url(${JSON.stringify(sectionArrowIcon)})` }" />
                          <span class="template-app-search__result-section-title">
                            {{ result.sectionTitle ?? 'Lead' }}
                          </span>
                        </span>
                      </span>
                      <img
                        v-if="result.thumbnailUrl"
                        class="template-app-search__result-thumb"
                        :src="result.thumbnailUrl"
                        alt=""
                        width="52"
                        height="52"
                      >
                    </span>

                    <!-- eslint-disable-next-line vue/no-v-html -->
                    <span
                      v-if="result.passageHtml"
                      class="template-app-search__result-passage"
                      v-html="result.passageHtml"
                    />
                  </span>

                  <span v-if="result.passageHtml" class="template-app-search__result-read">
                    Read in article
                  </span>

                  <span
                    v-if="signalsFor(result)?.contributors || signalsFor(result)?.references"
                    class="template-app-search__result-attribution"
                  >
                    <span class="template-app-search__result-signals">
                      <span
                        v-if="signalsFor(result)?.contributors"
                        class="template-app-search__result-signal"
                      >
                        <span class="template-app-search__icon" :style="{ '--icon': `url(${JSON.stringify(contributorsIcon)})` }" />
                        {{ signalsFor(result)?.contributors }} contributors
                      </span>
                      <span
                        v-if="signalsFor(result)?.references"
                        class="template-app-search__result-signal"
                      >
                        <span class="template-app-search__icon" :style="{ '--icon': `url(${JSON.stringify(referencesIcon)})` }" />
                        {{ signalsFor(result)?.references }} references
                      </span>
                    </span>
                  </span>
                </button>

                <!--
                  Figma "Result rating iOS" (10100:11305). Beside the card's button, not
                  in it (no buttons inside a button), on the same grey.
                -->
                <div class="template-app-search__result-rating" role="group" aria-label="Is this result relevant?">
                  <span class="template-app-search__result-rating-label">Is this result relevant?</span>
                  <span class="template-app-search__result-rating-buttons">
                    <button
                      type="button"
                      class="template-app-search__result-rating-button"
                      aria-label="Relevant"
                      :aria-pressed="relevance[resultKey(result)] === 'up'"
                      @click="rateResult(result, 'up')"
                    >
                      <span
                        class="template-app-search__rating-icon"
                        :style="{ '--icon': `url(${JSON.stringify(relevance[resultKey(result)] === 'up' ? thumbUpFilledIcon : thumbUpIcon)})` }"
                      />
                    </button>
                    <button
                      type="button"
                      class="template-app-search__result-rating-button"
                      aria-label="Not relevant"
                      :aria-pressed="relevance[resultKey(result)] === 'down'"
                      @click="rateResult(result, 'down')"
                    >
                      <!-- No filled thumb-down asset: the filled thumb-up turned over. -->
                      <span
                        class="template-app-search__rating-icon"
                        :class="{ 'template-app-search__rating-icon--down-filled': relevance[resultKey(result)] === 'down' }"
                        :style="{ '--icon': `url(${JSON.stringify(relevance[resultKey(result)] === 'down' ? thumbUpFilledIcon : thumbDownIcon)})` }"
                      />
                    </button>
                  </span>
                </div>
              </li>
            </template>

          </ul>

          <!-- Empty state, Figma "results screen: large detent" (10047:8809). -->
          <div v-else-if="showEmptyState" class="template-app-search__empty">
            <span class="template-app-search__empty-illustration" aria-hidden="true">
              <img class="template-app-search__empty-page" :src="emptyPage" alt="" width="40" height="56">
              <img class="template-app-search__empty-corner" :src="emptyPageCorner" alt="">
              <span class="template-app-search__empty-lines">
                <span /><span /><span /><span />
              </span>
              <img class="template-app-search__empty-wordmark" :src="emptyWordmark" alt="">
              <img class="template-app-search__empty-magnifier" :src="emptyMagnifier" alt="">
            </span>
            <p class="template-app-search__empty-text">No results for this search</p>
          </div>
        </template>
      </div>

      <div
        v-if="isIos"
        class="template-app-search__bottom-bar"
        :class="{ 'template-app-search__bottom-bar--keyboard': viewport.keyboardInset > 0 }"
      >
        <SearchInputField />
        <CdxButton weight="quiet" aria-label="Close" @click="goBack">
          <CdxIcon :icon="cdxIconClose" />
        </CdxButton>
      </div>

      <!-- iOS: above the 48px search bar. -->
      <FeedbackToast :message="toastMessage" :bottom-offset="isIos ? 48 : 0" />

      <ResultContextMenu
        :open="resultMenu.open"
        :x="resultMenu.x"
        :y="resultMenu.y"
        @select="onResultMenuSelect"
        @close="closeResultMenu"
      />

      <!-- "Learn more" only closes the sheet for now; "Turn off feature" opens Settings. -->
      <SearchInfoSheet
        :open="infoOpen"
        example-question="How was the Moon formed?"
        @close="infoOpen = false"
        @learn-more="infoOpen = false"
        @turn-off="openSettings"
      >
        <!-- The example result, Figma copy, in the real card styles. -->
        <div class="template-app-search__result template-app-search__result--example">
          <span class="template-app-search__result-body">
            <span class="template-app-search__result-header">
              <span class="template-app-search__result-text">
                <span class="template-app-search__result-title">K-U ratio</span>
                <span class="template-app-search__result-description">
                  Measure of volatile elements on planets
                </span>
                <span class="template-app-search__result-section">
                  <span class="template-app-search__icon" :style="{ '--icon': `url(${JSON.stringify(sectionArrowIcon)})` }" />
                  <span class="template-app-search__result-section-title">Earth’s Moon’s origin</span>
                </span>
              </span>
              <span class="template-app-search__example-thumb">
                <img :src="infoExampleMoon" alt="">
              </span>
            </span>
            <span class="template-app-search__result-passage">
              The prevailing theory is that the Moon formed out of the debris left over from a
              collision between Earth and an astronomical body the size of Mars, approximately
              4.5 billion o, about 20 to 100 million years after the Solar System coalesced.
              This is called the Giant-impact hypothesis.
            </span>
          </span>
          <span class="template-app-search__result-read">Read in article</span>
          <span class="template-app-search__result-attribution">
            <span class="template-app-search__result-signals">
              <span class="template-app-search__result-signal">
                <span class="template-app-search__icon" :style="{ '--icon': `url(${JSON.stringify(contributorsIcon)})` }" />
                2348 contributors
              </span>
              <span class="template-app-search__result-signal">
                <span class="template-app-search__icon" :style="{ '--icon': `url(${JSON.stringify(referencesIcon)})` }" />
                35 references
              </span>
            </span>
          </span>
        </div>
      </SearchInfoSheet>
    </div>

    <TestPanel
      :query="query"
      :words="countWords(query)"
      :classifier-route="supportsSemanticSearch(activeLang) ? routeQuery(query.trim()) : null"
      :reason="supportsSemanticSearch(activeLang) && query.trim() ? routeReason(query) : null"
      :route-in-use="currentRoute"
      :list-query="listQuery"
      @set-query="setQueryFromPanel"
    />
  </MobileWrapper>
</template>

<style scoped>
/*
 * The screen is pinned to the visible area (useVisualViewport): below the browser
 * bars, above the keyboard. Mobile Safari overlays the keyboard instead of resizing
 * the page, so this is what keeps the iOS search bar (the last row) on top of it.
 * Only the results area scrolls; the page itself never does.
 */
.template-app-search-shell {
  position: fixed;
  top: var(--viewport-top, 0px);
  left: 50%;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: min(100vw, 412px);
  height: var(--viewport-height, 100dvh);
  background-color: var(--background-color-base, #fff);
  color: var(--color-base, #202122);
  transform: translateX(-50%);
}

.template-app-search__input {
  flex: 1 1 auto;
  width: 100%;
  min-width: 0;
}

/*
 * The results area: the only part of the screen that scrolls (tabs stick inside it).
 * No top padding: a sticky child can't cancel it with a negative margin (it gets pushed
 * back down), so the space above the tabs is the tabs row's own padding.
 */
.template-app-search {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0 var(--spacing-150, 24px) var(--spacing-100, 16px);
}

/*
 * iOS: the search field is the screen's last row, so it sits on top of the keyboard.
 * While the keyboard is shut, room below it for the home indicator.
 */
.template-app-search__bottom-bar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: var(--spacing-50, 8px);
  padding: var(--spacing-50, 8px) var(--spacing-150, 24px)
    calc(var(--spacing-50, 8px) + env(safe-area-inset-bottom, 0px));
  background-color: var(--background-color-base, #fff);
}

.template-app-search__bottom-bar--keyboard {
  padding-bottom: var(--spacing-50, 8px);
}

.template-app-search__bottom-bar .template-app-search__input {
  flex: 1 1 auto;
  min-width: 0;
}

/* Stays on top while the results scroll under it (full width, with 8px above). */
.template-app-search__lang-row {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-100, 16px);
  margin-inline: calc(-1 * var(--spacing-150, 24px));
  padding: var(--spacing-50, 8px) var(--spacing-150, 24px) 0;
  background-color: var(--background-color-base, #fff);
}

.template-app-search__tabs {
  flex: 1 1 auto;
  min-width: 0;
}

.template-app-search__more {
  flex-shrink: 0;
  font-weight: var(--font-weight-normal, 400);
}

/* Figma 10055:4474: right-aligned Beta badge + info icon button, full-bleed row. */
.template-app-search__beta-row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  margin-inline: calc(-1 * var(--spacing-150, 24px));
  padding: var(--spacing-25, 4px) var(--spacing-100, 16px) 0;
}

.template-app-search__beta-badge {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-12, 2px);
  box-sizing: border-box;
  height: 20px;
  padding-inline: var(--spacing-25, 4px);
  border: 1px solid var(--border-color-muted, #eaecf0);
  border-radius: var(--border-radius-pill, 9999px);
  color: var(--color-base, #202122);
  font-size: 11px;
  line-height: 16px;
  font-weight: 500;
  letter-spacing: 0.5px;
}

/* 48px touch target around a 40px round state layer. */
.template-app-search__result-count {
  /* Pushes Beta and ⓘ to the end; the row's padding lines it up with the card text. */
  margin-inline-end: auto;
  color: var(--color-subtle, #54595d);
  font-size: 12px;
  line-height: 16px;
}

.template-app-search__info {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
}

.template-app-search__info-state {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--border-radius-pill, 9999px);
}

.template-app-search__info:hover .template-app-search__info-state {
  background-color: var(--background-color-interactive-subtle--hover, #eaecf0);
}

.template-app-search__info:active .template-app-search__info-state {
  background-color: var(--background-color-interactive-subtle--active, #dadde3);
}

.template-app-search__section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: var(--spacing-100, 16px);
}

.template-app-search__section-title {
  margin: 0;
  font-family: inherit;
  font-size: var(--font-size-large, 1rem);
  font-weight: var(--font-weight-bold, 700);
}

/* Empty state: the rest of the screen, its illustration and text centred in it. */
.template-app-search--empty {
  display: flex;
  flex-direction: column;
}

.template-app-search__empty {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-50, 8px);
}

/* 60 × 77, pieces placed as in Figma (the page's stroke overhangs its 38 × 54 box). */
.template-app-search__empty-illustration {
  position: relative;
  flex-shrink: 0;
  width: 60px;
  height: 77px;
}

.template-app-search__empty-illustration > * {
  position: absolute;
}

.template-app-search__empty-page {
  top: 0;
  left: 0;
}

.template-app-search__empty-corner {
  top: 1.51px;
  left: 32.34px;
  width: 7.262px;
  height: 6.89px;
}

.template-app-search__empty-lines {
  top: 29px;
  left: 3.89px;
  display: flex;
  flex-direction: column;
  gap: 2.6px;
  width: 31.78px;
}

.template-app-search__empty-lines > span {
  height: 3.586px;
  border-radius: 800px;
  background-color: #a2a9b1;
}

.template-app-search__empty-lines > span:nth-child(2),
.template-app-search__empty-lines > span:nth-child(3) {
  width: 11.751px;
}

.template-app-search__empty-wordmark {
  top: 7.67px;
  left: 9.44px;
  width: 21.118px;
  height: 14.376px;
}

.template-app-search__empty-magnifier {
  top: 22.44px;
  left: 7.71px;
  width: 50.549px;
  height: 52.737px;
}

.template-app-search__empty-text {
  margin: 0;
  color: var(--color-base, #202122);
  font-size: 14px;
  line-height: 20px;
  letter-spacing: 0.25px;
  text-align: center;
}

.template-app-search__status {
  margin-top: var(--spacing-100, 16px);
  color: var(--color-subtle, #54595d);
}

.template-app-search__recent-list,
.template-app-search__results {
  list-style: none;
  margin: 0;
  padding: 0;
}

.template-app-search__recent-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-100, 16px);
  margin-top: var(--spacing-100, 16px);
}

.template-app-search__recent-item {
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  background: none;
  text-align: left;
  color: var(--color-base, #202122);
  font-size: var(--font-size-medium, 1rem);
  line-height: var(--line-height-medium, 1.625);
  font-weight: var(--font-weight-normal, 400);
  cursor: pointer;
}

.template-app-search__results {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-50, 8px);
  /* Full-bleed cards: cancel the page's side padding. */
  margin: var(--spacing-50, 8px) calc(-1 * var(--spacing-150, 24px)) 0;
}

/* global.css gives every li 4px block margins; the gap alone sets card spacing. */
.template-app-search__results > li {
  margin-block: 0;
}

/* Figma "New Card (Interleaved) Android" (10041:3712): flat grey card, header rule,
   then "Read in article" and an attribution strip. */
.template-app-search__result {
  display: flex;
  flex-direction: column;
  width: 100%;
  padding: var(--spacing-100, 16px) var(--spacing-100, 16px) 0;
  border: 0;
  border-radius: 0;
  background-color: var(--background-color-interactive-subtle, #f8f9fa);
  text-align: left;
  color: var(--color-base, #202122);
  font: inherit;
  cursor: pointer;
}

/*
 * "Is this result relevant?": 64px — two 44px tap targets, 4px apart. Label 16px in
 * from the left; the thumb-down icon's edge 16px in from the right.
 */
.template-app-search__result-rating {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 64px;
  padding: 0 var(--spacing-100, 16px);
  background-color: var(--background-color-interactive-subtle, #f8f9fa);
}

.template-app-search__result-rating-label {
  overflow: hidden;
  color: var(--color-subtle, #54595d);
  font-size: 12px;
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.template-app-search__result-rating-buttons {
  display: flex;
  flex-shrink: 0;
  gap: var(--spacing-25, 4px);
  /* The 44px target has 12px around its 20px icon: let that overhang the padding. */
  margin-right: -12px;
}

.template-app-search__result-rating-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--color-subtle, #54595d);
  cursor: pointer;
}

.template-app-search__result-rating-button[aria-pressed='true'] {
  color: var(--color-base, #202122);
}

/* The thumb SVGs as masks, so they take the button's colour (and follow the theme). */
.template-app-search__rating-icon {
  display: block;
  width: 20px;
  height: 20px;
  background-color: currentColor;
  mask: var(--icon) center / contain no-repeat;
  -webkit-mask: var(--icon) center / contain no-repeat;
}

.template-app-search__rating-icon--down-filled {
  transform: rotate(180deg);
}

.template-app-search__skeleton-bar--rating {
  width: 140px;
}

.template-app-search__result-body {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-50, 8px);
  width: 100%;
}

/* A long press opens the result menu: no text selection or browser callout meanwhile. */
button.template-app-search__result {
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  user-select: none;
}

/* The info sheet's example card: not tappable, and the sheet is always light. */
.template-app-search__result--example {
  background-color: #f8f9fa;
  color: #202122;
  cursor: default;
}

/* Figma crops the example photo tighter than object-fit: cover would. */
.template-app-search__example-thumb {
  position: relative;
  flex-shrink: 0;
  width: 52px;
  height: 52px;
  overflow: hidden;
  border-radius: 8px;
}

.template-app-search__example-thumb img {
  position: absolute;
  top: -9.13%;
  left: -26.56%;
  width: 145.51%;
  height: 109.13%;
  max-width: none;
}

.template-app-search__result-header {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-100, 16px);
  padding-bottom: var(--spacing-50, 8px);
  border-bottom: 1px solid var(--border-color-muted, #eaecf0);
}

.template-app-search__result-text {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  flex-direction: column;
}

.template-app-search__result-debug {
  align-self: flex-start;
  margin-bottom: var(--spacing-25, 4px);
}

/* Title, description and section title: each at most 2 lines, then an ellipsis. */
.template-app-search__result-title {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  font-size: 16px;
  line-height: 24px;
  font-weight: var(--font-weight-semi-bold, 600);
  letter-spacing: 0.15px;
}

.template-app-search__result-title :deep(.searchmatch) {
  font-weight: inherit;
}

.template-app-search__result-description {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  color: var(--color-subtle, #54595d);
  font-size: 14px;
  line-height: 20px;
  letter-spacing: 0.25px;
}

.template-app-search__result-thumb {
  flex-shrink: 0;
  width: 52px;
  height: 52px;
  border-radius: 8px;
  object-fit: cover;
}

.template-app-search__result-passage {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 8;
  line-clamp: 8;
  font-size: 14px;
  line-height: 20px;
  letter-spacing: 0.25px;
}

/* Bold: the answer in semantic passages, the query's keywords in lexical ones. */
.template-app-search__result-passage :deep(.searchmatch) {
  font-weight: var(--font-weight-bold, 700);
}

/* Lexical and semantic routes only: in an interleaved list, bold would reveal the
   retriever (see listIsInterleaved). */
.template-app-search__results--interleaved .template-app-search__result-passage :deep(.searchmatch) {
  font-weight: inherit;
}

.template-app-search__result-read {
  display: block;
  padding: var(--spacing-25, 4px) 0 var(--spacing-50, 8px);
  color: var(--color-subtle, #54595d);
  font-size: 12px;
  line-height: 16px;
  font-weight: var(--font-weight-semi-bold, 500);
  letter-spacing: 0.5px;
}

.template-app-search__result-attribution {
  display: flex;
  width: 100%;
  padding: var(--spacing-50, 8px) 0;
  border-top: 0.5px solid var(--border-color-muted, #eaecf0);
}

/* Figma "New Card (Interleaved) iOS" (10090:6495): under the description, up to 2 lines;
   the arrow sits on the first line. */
.template-app-search__result-section {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-25, 4px);
  padding-top: var(--spacing-25, 4px);
}

/* The Figma SVGs used as masks (quoted: the data URIs contain quotes), so they take
   the text colour and follow the theme. */
.template-app-search__icon {
  display: block;
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  background-color: currentColor;
  mask: var(--icon) center / contain no-repeat;
  -webkit-mask: var(--icon) center / contain no-repeat;
}

.template-app-search__result-section-title {
  flex: 1 1 0;
  min-width: 0;
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  font-size: 12px;
  line-height: 16px;
  letter-spacing: 0.4px;
}

.template-app-search__result-signals {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-50, 8px) var(--spacing-100, 16px);
  color: var(--color-subtle, #54595d);
  font-size: 12px;
  line-height: 16px;
}

.template-app-search__result-signal {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-25, 4px);
}

/* Codex has no skeleton component. The skeleton reuses the card classes; each bar
   takes its text's line height, with a thinner grey bar centred in it. */
.template-app-search__skeleton {
  cursor: default;
}

.template-app-search__skeleton-passage {
  display: flex;
  flex-direction: column;
}

.template-app-search__skeleton-bar {
  display: flex;
  align-items: center;
  width: 100%;
}

.template-app-search__skeleton-bar::before,
.template-app-search__skeleton-thumb {
  border-radius: 4px;
  background-color: var(--background-color-interactive, #eaecf0);
  animation: template-app-search-pulse 1.5s ease-in-out infinite;
}

.template-app-search__skeleton-bar::before {
  content: '';
  width: 100%;
  height: 60%;
}

/* Line heights match the card text: title 24, body 20, small text 16. */
.template-app-search__skeleton-bar--title {
  width: 60%;
  height: 24px;
}

.template-app-search__skeleton-bar--body {
  height: 20px;
}

.template-app-search__skeleton-bar--small {
  height: 16px;
}

.template-app-search__skeleton-bar--short {
  width: 40%;
}

.template-app-search__skeleton-bar--read {
  width: 88px;
}

.template-app-search__skeleton-bar--section {
  width: 70%;
}

.template-app-search__skeleton-bar--signal {
  width: 96px;
}

.template-app-search__skeleton-thumb {
  flex-shrink: 0;
  width: 52px;
  height: 52px;
  border-radius: 8px;
}

@keyframes template-app-search-pulse {
  50% {
    opacity: 0.5;
  }
}

@media (prefers-reduced-motion: reduce) {
  .template-app-search__skeleton-bar::before,
  .template-app-search__skeleton-thumb {
    animation: none;
  }
}
</style>
