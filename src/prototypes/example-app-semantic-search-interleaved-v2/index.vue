<script setup lang="ts">
import { cdxIconSearch } from '@wikimedia/codex-icons'

definePage({
  meta: {
    title: 'Semantic Search Interleaved V2',
    category: 'example',
    platform: 'app',
    order: 3,
    icon: cdxIconSearch,
  },
})

import { computed, defineComponent, h, ref, watch } from 'vue'
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
import {
  cdxIconClose,
  cdxIconReferences,
  cdxIconTrash,
  cdxIconUserGroup,
} from '@wikimedia/codex-icons'

import AppChromeHeader from '@/components/app/AppChromeHeader.vue'
import type { AppHeaderItem } from '@/components/app/AppChromeHeader.vue'
import MobileWrapper from '@/components/MobileWrapper.vue'
import { useIsIos } from '@/composables/useAppPlatform'

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
import { useResultSignals } from './useResultSignals'

const router = useRouter()
const route = useRoute()

/** `?debug=1` labels each result with the retriever that placed it. Readers never see this. */
const debug = computed(() => route.query.debug === '1')
const isIos = useIsIos()

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
      return
    }

    // A failed semantic search shouldn't hide the lexical results.
    const [lexical, semantic] = await Promise.all([
      searchWiki(trimmed, options),
      searchSemantic(trimmed, options).catch(() => []),
    ])
    if (signal.aborted) return
    results.value = interleaveResults(lexical, semantic)
  } catch (err) {
    if (signal.aborted) return
    searchError.value = err instanceof Error ? err.message : 'Search failed.'
    results.value = []
  } finally {
    if (!signal.aborted) searching.value = false
  }
}

watch([query, activeLang], ([, lang], [, prevLang]) => {
  if (debounceHandle) clearTimeout(debounceHandle)

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
    <div class="template-app-search-shell">
      <AppChromeHeader v-if="!isIos" :left="searchHeaderLeft" :right="[]" />

      <div class="template-app-search">
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

          <ul v-if="showSkeleton" class="template-app-search__results" aria-hidden="true">
            <li v-for="n in 3" :key="n" class="template-app-search__skeleton">
              <span class="template-app-search__result-header">
                <span class="template-app-search__result-text">
                  <span class="template-app-search__skeleton-line template-app-search__skeleton-line--title" />
                  <span class="template-app-search__skeleton-line template-app-search__skeleton-line--short" />
                </span>
                <span class="template-app-search__skeleton-thumb" />
              </span>
              <span class="template-app-search__result-text">
                <span class="template-app-search__skeleton-line" />
                <span class="template-app-search__skeleton-line" />
                <span class="template-app-search__skeleton-line template-app-search__skeleton-line--short" />
              </span>
            </li>
          </ul>

          <ul v-else-if="results.length" class="template-app-search__results">
            <li v-for="result in results" :key="`${result.source}-${result.pageid}`">
              <button
                type="button"
                class="template-app-search__result"
                @click="selectResult(result)"
              >
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
                    width="56"
                    height="56"
                  />
                </span>

                <template v-if="result.passageHtml">
                  <!-- eslint-disable-next-line vue/no-v-html -->
                  <span class="template-app-search__result-passage" v-html="result.passageHtml" />
                  <span class="template-app-search__result-read">Read in article</span>
                </template>

                <span
                  v-if="signalsFor(result)?.contributors || signalsFor(result)?.references"
                  class="template-app-search__result-signals"
                >
                  <span
                    v-if="signalsFor(result)?.contributors"
                    class="template-app-search__result-signal"
                  >
                    <CdxIcon :icon="cdxIconUserGroup" size="small" />
                    {{ signalsFor(result)?.contributors }} contributors
                  </span>
                  <span
                    v-if="signalsFor(result)?.references"
                    class="template-app-search__result-signal"
                  >
                    <CdxIcon :icon="cdxIconReferences" size="small" />
                    {{ signalsFor(result)?.references }} references
                  </span>
                </span>
              </button>
            </li>
          </ul>
        </template>
      </div>

      <div v-if="isIos" class="template-app-search__bottom-bar">
        <SearchInputField />
        <CdxButton weight="quiet" aria-label="Close" @click="goBack">
          <CdxIcon :icon="cdxIconClose" />
        </CdxButton>
      </div>
    </div>
  </MobileWrapper>
</template>

<style scoped>
.template-app-search-shell {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  background-color: var(--background-color-base, #fff);
  color: var(--color-base, #202122);
}

.template-app-search__input {
  flex: 1 1 auto;
  width: 100%;
  min-width: 0;
}

.template-app-search {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: var(--spacing-100, 16px) var(--spacing-150, 24px);
}

.template-app-search__bottom-bar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: var(--spacing-50, 8px);
  padding: var(--spacing-50, 8px) var(--spacing-150, 24px);
}

.template-app-search__bottom-bar .template-app-search__input {
  flex: 1 1 auto;
  min-width: 0;
}

.template-app-search__lang-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-100, 16px);
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

.template-app-search__results {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-100, 16px);
  margin-top: var(--spacing-100, 16px);
}

.template-app-search__result {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-100, 16px);
  width: 100%;
  padding: var(--spacing-100, 16px);
  border: 0;
  /* Codex has no large-radius token; 8px matches the Figma card. */
  border-radius: 8px;
  background-color: var(--background-color-interactive-subtle, #f8f9fa);
  text-align: left;
  color: var(--color-base, #202122);
  font: inherit;
  cursor: pointer;
}

/* Codex has no skeleton component; bars sit on the card in the next-darker grey. */
.template-app-search__skeleton {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-100, 16px);
  padding: var(--spacing-100, 16px);
  border-radius: 8px;
  background-color: var(--background-color-interactive-subtle, #f8f9fa);
}

.template-app-search__skeleton-line,
.template-app-search__skeleton-thumb {
  display: block;
  border-radius: 4px;
  background-color: var(--background-color-interactive, #eaecf0);
  animation: template-app-search-pulse 1.5s ease-in-out infinite;
}

.template-app-search__skeleton-line {
  width: 100%;
  height: 1rem;
  margin-block: var(--spacing-25, 4px);
}

.template-app-search__skeleton-line--title {
  width: 60%;
  height: 1.25rem;
}

.template-app-search__skeleton-line--short {
  width: 40%;
}

.template-app-search__skeleton-thumb {
  flex-shrink: 0;
  width: 3.5rem;
  height: 3.5rem;
  border-radius: 8px;
}

@keyframes template-app-search-pulse {
  50% {
    opacity: 0.5;
  }
}

@media (prefers-reduced-motion: reduce) {
  .template-app-search__skeleton-line,
  .template-app-search__skeleton-thumb {
    animation: none;
  }
}

.template-app-search__result-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--spacing-75, 12px);
}

.template-app-search__result-text {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  flex-direction: column;
  gap: var(--spacing-12, 2px);
}

.template-app-search__result-debug {
  align-self: flex-start;
  margin-bottom: var(--spacing-25, 4px);
}

.template-app-search__result-title {
  display: block;
  font-size: var(--font-size-large, 1.125rem);
  line-height: var(--line-height-large, 1.75rem);
  font-weight: var(--font-weight-bold, 700);
}

.template-app-search__result-title :deep(.searchmatch) {
  font-weight: inherit;
}

.template-app-search__result-description {
  display: block;
  color: var(--color-subtle, #54595d);
  font-size: var(--font-size-medium, 1rem);
  line-height: var(--line-height-medium, 1.625rem);
}

.template-app-search__result-thumb {
  flex-shrink: 0;
  width: 3.5rem;
  height: 3.5rem;
  border-radius: 8px;
  object-fit: cover;
}

.template-app-search__result-passage {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 8;
  line-clamp: 8;
  font-size: var(--font-size-medium, 1rem);
  line-height: var(--line-height-medium, 1.625rem);
}

/* No bold matches: lexical first paragraphs never have them, so bold in semantic
   passages would reveal the retriever. */
.template-app-search__result-passage :deep(.searchmatch) {
  font-weight: inherit;
}

.template-app-search__result-passage :deep(.search-answer) {
  border-radius: 2px;
  background-color: var(--background-color-warning-subtle, #fdf2d5);
  color: inherit;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}

.template-app-search__result-read {
  display: block;
  margin-top: calc(-1 * var(--spacing-50, 8px));
  color: var(--color-subtle, #54595d);
  font-size: var(--font-size-small, 0.875rem);
  line-height: var(--line-height-small, 1.375rem);
}

.template-app-search__result-signals {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-50, 8px) var(--spacing-75, 12px);
  padding: var(--spacing-75, 12px);
  border-radius: 8px;
  background-color: var(--background-color-interactive, #eaecf0);
  color: var(--color-subtle, #54595d);
  font-size: var(--font-size-small, 0.875rem);
  line-height: var(--line-height-small, 1.375rem);
}

.template-app-search__result-signal {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-25, 4px);
}

.template-app-search__result-signal :deep(.cdx-icon) {
  color: var(--color-subtle, #54595d);
}
</style>
