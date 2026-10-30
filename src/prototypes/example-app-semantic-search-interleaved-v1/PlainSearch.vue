<script setup lang="ts">
/**
 * Search with "Search within articles" off (Settings): `template-app-search`'s screen,
 * copied, with one change — results come from this prototype's lexical `searchWiki`,
 * which falls back to full-text search when no title matches (as the Wikipedia apps
 * do), so questions like "can dogs eat chocolate?" still get results. The template
 * itself only completes titles. No passages, Beta row or feedback; results open
 * `template-app-article`.
 */
import { computed, defineComponent, h, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  CdxButton,
  CdxIcon,
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

import {
  DEFAULT_SEARCH_LANGUAGES,
  MORE_SEARCH_LANGUAGES,
  type SearchLanguageOption,
} from './searchLanguages'
import { searchWiki, type WikiSearchResult } from './searchWiki'
import { useVisualViewport } from './useVisualViewport'
import { useRecentSearches } from './useRecentSearches'

const router = useRouter()
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

const { recentSearches, addRecentSearch, clearRecentSearches } = useRecentSearches()

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
  if (!trimmed.length) {
    results.value = []
    searchError.value = null
    return
  }

  searchAbort?.abort()
  searchAbort = new AbortController()
  const { signal } = searchAbort

  searchError.value = null

  try {
    const found = await searchWiki(trimmed, { signal, lang: activeLang.value })
    if (signal.aborted) return
    results.value = found
    scrollResultsToTop()
  } catch (err) {
    if (signal.aborted) return
    searchError.value = err instanceof Error ? err.message : 'Search failed.'
    results.value = []
  }
}

/**
 * New results always start at the top. Only the results area scrolls (the page is
 * pinned to the visible area), so this never fights mobile Safari's own scrolling.
 */
function scrollResultsToTop(): void {
  resultsScroller.value?.scrollTo({ top: 0 })
}

watch([query, activeLang], () => {
  if (debounceHandle) clearTimeout(debounceHandle)
  scrollResultsToTop()
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

function selectResult(result: WikiSearchResult): void {
  addRecentSearch(query.value)
  router.push({
    path: '/template-app-article',
    query: { article: result.title, lang: activeLang.value },
  })
}
</script>

<template>
  <MobileWrapper>
    <div
      class="template-app-search-shell"
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

          <ul v-if="results.length" class="template-app-search__results">
            <li v-for="result in results" :key="result.pageid">
              <button
                type="button"
                class="template-app-search__result"
                @click="selectResult(result)"
              >
                <span class="template-app-search__result-text">
                  <!-- eslint-disable-next-line vue/no-v-html -->
                  <span class="template-app-search__result-title" v-html="result.titleHtml" />
                  <span v-if="result.description" class="template-app-search__result-snippet">
                    {{ result.description }}
                  </span>
                </span>
                <img
                  v-if="result.thumbnailUrl"
                  class="template-app-search__result-thumb"
                  :src="result.thumbnailUrl"
                  alt=""
                  width="64"
                  height="64"
                />
              </button>
            </li>
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

/* The results area: the only part of the screen that scrolls (tabs stick inside it). */
.template-app-search {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: var(--spacing-100, 16px) var(--spacing-150, 24px);
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

/* Stays on top while the results scroll under it (full width, with the 16px above). */
.template-app-search__lang-row {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-100, 16px);
  margin: calc(-1 * var(--spacing-100, 16px)) calc(-1 * var(--spacing-150, 24px)) 0;
  padding: var(--spacing-100, 16px) var(--spacing-150, 24px) 0;
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

.template-app-search__section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: var(--spacing-100, 16px);
}

.template-app-search__section-title {
  margin: 0;
  font-family:
    var(--font-family-system-sans, system-ui, sans-serif), var(--font-family-base, sans-serif);
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

.template-app-search__result {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-start-typeahead-search-figure, 12px);
  width: 100%;
  padding: var(--spacing-75, 12px) 0;
  border: 0;
  border-bottom: var(--border-width-base, 1px) solid var(--border-color-subtle, #c8ccd1);
  background: none;
  text-align: left;
  color: var(--color-base, #202122);
  font: inherit;
  cursor: pointer;
}

.template-app-search__result-text {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  flex-direction: column;
  gap: var(--spacing-12, 2px);
}

.template-app-search__result-title {
  display: block;
  font-weight: var(--font-weight-normal, 400);
}

.template-app-search__result-snippet {
  display: block;
  color: var(--color-subtle, #54595d);
  font-size: var(--font-size-small, 0.875rem);
  font-weight: var(--font-weight-normal, 400);
}

.template-app-search__result-title :deep(.searchmatch) {
  font-weight: var(--font-weight-bold, 700);
  color: var(--color-base, #202122);
}

.template-app-search__result-thumb {
  flex-shrink: 0;
  width: 4rem;
  height: 4rem;
  border-radius: var(--border-radius-base, 2px);
  object-fit: cover;
}
</style>
