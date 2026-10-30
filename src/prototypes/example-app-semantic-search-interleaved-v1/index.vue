<script setup lang="ts">
import { cdxIconSearch } from '@wikimedia/codex-icons'

definePage({
  meta: {
    title: 'Semantic Search Interleaved V1',
    category: 'example',
    platform: 'app',
    order: 3,
    icon: cdxIconSearch,
  },
})

import { computed, defineComponent, h, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  CdxButton,
  CdxIcon,
  CdxInfoChip,
  CdxMenuButton,
  CdxMessage,
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
import referencesIcon from './assets/references.svg'
import sectionArrowIcon from './assets/subdirectory-arrow-right.svg'

import {
  DEFAULT_SEARCH_LANGUAGES,
  MORE_SEARCH_LANGUAGES,
  minQueryLength,
  type SearchLanguageOption,
} from './searchLanguages'
import { interleaveResults } from './interleave'
import {
  supportsSemanticSearch,
  searchSemantic,
  searchWiki,
  type WikiSearchResult,
} from './searchWiki'
import { useRecentSearches } from './useRecentSearches'
import FeedbackToast from './FeedbackToast.vue'
import ListFeedback from './ListFeedback.vue'
import ResultContextMenu, { type ResultMenuAction } from './ResultContextMenu.vue'
import SearchInfoSheet from './SearchInfoSheet.vue'
import { recordResultListArrival, useFeedbackToast, useListFeedback } from './searchFeedback'
import { useResultSignals } from './useResultSignals'
import { searchWithinArticles } from './searchSettings'
import { useLongPress } from './useLongPress'
import { useVisualViewport } from './useVisualViewport'
import PlainSearch from './PlainSearch.vue'
import './roboto.css'

const router = useRouter()
const route = useRoute()

/** `?debug=1` labels each result with the retriever that placed it. Readers never see this. */
const debug = computed(() => route.query.debug === '1')
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

const belowMinimum = computed(() => queryLength(query.value) < minQueryLength(activeLang.value))
/** Skeleton from the first character until results are ready. */
const showSkeleton = computed(
  () => !results.value.length && !searchError.value && (belowMinimum.value || searching.value),
)

/** Result cards on screen (not the skeleton): starts the list feedback's 3 s timer. */
const listRendered = computed(() => !showSkeleton.value && results.value.length > 0)
/** See searchFeedback.ts. `reactive` so the template reads `listFeedback.visible` etc. */
const listFeedback = reactive(useListFeedback({ listRendered, query, lang: activeLang }))
const { message: feedbackToast } = useFeedbackToast()

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

async function runSearch(): Promise<void> {
  const trimmed = query.value.trim()
  if (belowMinimum.value) return

  searchAbort?.abort()
  searchAbort = new AbortController()
  const { signal } = searchAbort

  searchError.value = null

  try {
    const options = { signal, lang: activeLang.value }

    // Wikis without semantic search: today's lexical list, no semantic request.
    if (!supportsSemanticSearch(activeLang.value)) {
      const lexical = await searchWiki(trimmed, options)
      if (signal.aborted) return
      results.value = lexical
      scrollResultsToTop()
      return
    }

    // A failed semantic search shouldn't hide the lexical results.
    const [lexical, semantic] = await Promise.all([
      searchWiki(trimmed, options),
      searchSemantic(trimmed, options).catch(() => []),
    ])
    if (signal.aborted) return
    results.value = interleaveResults(lexical, semantic)
    scrollResultsToTop()
  } catch (err) {
    if (signal.aborted) return
    searchError.value = err instanceof Error ? err.message : 'Search failed.'
    results.value = []
  } finally {
    if (!signal.aborted) searching.value = false
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
  scrollResultsToTop()

  // Results from another wiki, or for a too-short query, are never shown.
  if (lang !== prevLang || belowMinimum.value) {
    results.value = []
    searchError.value = null
  }

  // Empty or below the minimum: request nothing, and drop any request in flight.
  if (belowMinimum.value) {
    searchAbort?.abort()
    searching.value = false
    return
  }

  searching.value = true
  debounceHandle = setTimeout(() => {
    void runSearch()
  }, 250)
})

function onSubmit(): void {
  if (debounceHandle) clearTimeout(debounceHandle)
  addRecentSearch(query.value)
  void runSearch()
}

function selectRecentSearch(term: string): void {
  query.value = term
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
  addRecentSearch(query.value)
  // Lets the article offer its feedback card (see searchFeedback.ts).
  recordResultListArrival()
  router.push(articleLocation(result))
}

/* ---------- Long-press menu on a result card ---------- */

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

      <div ref="resultsScroller" class="template-app-search">
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
          v-if="query.trim() && (showSkeleton || results.length)"
          class="template-app-search__beta-row"
        >
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
          <CdxMessage v-if="searchError" type="warning">{{ searchError }}</CdxMessage>

          <!-- Built from the card's own classes so it has the card's size: no jump on load. -->
          <ul v-if="showSkeleton" class="template-app-search__results" aria-hidden="true">
            <li v-for="n in 3" :key="n">
              <div class="template-app-search__result template-app-search__skeleton">
                <span class="template-app-search__result-body">
                  <span class="template-app-search__result-header">
                    <span class="template-app-search__result-text">
                      <span class="template-app-search__skeleton-bar template-app-search__skeleton-bar--title" />
                      <span class="template-app-search__skeleton-bar template-app-search__skeleton-bar--small template-app-search__skeleton-bar--short" />
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
                  <span class="template-app-search__result-section">
                    <span class="template-app-search__skeleton-bar template-app-search__skeleton-bar--small template-app-search__skeleton-bar--section" />
                  </span>
                  <span class="template-app-search__result-signals">
                    <span class="template-app-search__skeleton-bar template-app-search__skeleton-bar--small template-app-search__skeleton-bar--signal" />
                    <span class="template-app-search__skeleton-bar template-app-search__skeleton-bar--small template-app-search__skeleton-bar--signal" />
                  </span>
                </span>
              </div>
            </li>
          </ul>

          <ul v-else-if="results.length" class="template-app-search__results">
            <template v-for="(result, index) in results" :key="`${result.source}-${result.pageid}`">
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
                        <span
                          v-if="result.description"
                          class="template-app-search__result-description"
                        >
                          {{ result.description }}
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
                    v-if="
                      result.sectionTitle ||
                      signalsFor(result)?.contributors ||
                      signalsFor(result)?.references
                    "
                    class="template-app-search__result-attribution"
                  >
                    <span v-if="result.sectionTitle" class="template-app-search__result-section">
                      <span class="template-app-search__icon" :style="{ '--icon': `url(${JSON.stringify(sectionArrowIcon)})` }" />
                      <span class="template-app-search__result-section-title">
                        {{ result.sectionTitle }}
                      </span>
                    </span>

                    <span
                      v-if="signalsFor(result)?.contributors || signalsFor(result)?.references"
                      class="template-app-search__result-signals"
                    >
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
              </li>

              <!-- List feedback: 3 s after the list renders, after the first card. -->
              <li
                v-if="index === 0 && listFeedback.visible"
                class="template-app-search__feedback-slot"
              >
                <ListFeedback
                  v-model:rating="listFeedback.rating"
                  v-model:comment="listFeedback.comment"
                  @submit="listFeedback.submit"
                />
              </li>
            </template>

          </ul>
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
      <FeedbackToast :message="feedbackToast" :bottom-offset="isIos ? 48 : 0" />

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
            <span class="template-app-search__result-section">
              <span class="template-app-search__icon" :style="{ '--icon': `url(${JSON.stringify(sectionArrowIcon)})` }" />
              <span class="template-app-search__result-section-title">Earth’s Moon’s origin</span>
            </span>
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

/* The feedback card is inset 16px from the screen edges (328px on a 360px screen). */
.template-app-search__results > .template-app-search__feedback-slot {
  margin-inline: var(--spacing-100, 16px);
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

.template-app-search__result-title {
  display: block;
  font-size: 16px;
  line-height: 24px;
  font-weight: var(--font-weight-semi-bold, 600);
  letter-spacing: 0.15px;
}

.template-app-search__result-title :deep(.searchmatch) {
  font-weight: inherit;
}

.template-app-search__result-description {
  display: block;
  overflow: hidden;
  color: var(--color-subtle, #54595d);
  font-size: 12px;
  line-height: 16px;
  letter-spacing: 0.4px;
  text-overflow: ellipsis;
  white-space: nowrap;
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

/* No bold matches: lexical first paragraphs never have them, so bold in semantic
   passages would reveal the retriever. */
.template-app-search__result-passage :deep(.searchmatch) {
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
  flex-direction: column;
  gap: var(--spacing-50, 8px);
  width: 100%;
  padding: var(--spacing-50, 8px) 0;
  border-top: 0.5px solid var(--border-color-muted, #eaecf0);
}

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
  display: -webkit-box;
  flex: 1 1 0;
  min-width: 0;
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
