<script setup lang="ts">
/**
 * Test panel: desktop only (1100px and wider, beside the phone column), never part of
 * the experience being tested. Shows what the classifier decided for the query, and
 * simulates the connection speed.
 */
import { onBeforeUnmount, watch, type WatchStopHandle } from 'vue'
import { CdxButton, CdxField, CdxSelect, CdxToggleButtonGroup } from '@wikimedia/codex'

import { routeQuery } from './routeQuery'
import { SEMANTIC_TIMEOUT_MS } from './searchWiki'
import { CONNECTION_DELAYS_MS, testSettings, type RetrieverBehaviour } from './testPanel'

const connectionButtons = [
  { value: 'fast', label: 'Fast' },
  { value: 'medium', label: 'Medium' },
  { value: 'slow', label: 'Very slow' },
]

const props = defineProps<{
  query: string
  words: number
  /** What EF-1 decides for the query; `null` where nothing is classified. */
  classifierRoute: string | null
  reason: string | null
  /** The route the search actually takes (control, overrides and other wikis included). */
  routeInUse: string
  /** The query of the list on screen, `null` for none. */
  listQuery: string | null
}>()

const emit = defineEmits<{
  setQuery: [query: string]
  showOnboarding: []
}>()

interface EdgeCase {
  label: string
  /** The query; a second step, if any, replaces it (see `nextAfter`). */
  steps: [string] | [string, string]
  /**
   * When the second step lands: once the first query's results have loaded (then
   * after RESULTS_STAY_MS), or after this many ms of typing.
   */
  nextAfter?: 'results' | number
}

/** How long the first results stay on screen before the query is edited. */
const RESULTS_STAY_MS = 1000

/** US-1 edge cases. The whole query lands at once, as when pasted or dictated. */
const US1_EDGE_CASES: EdgeCase[] = [
  { label: 'Two words followed by a trailing space', steps: ['the moon '] },
  { label: 'Hyphenated words and numbers', steps: ['covid-19 vaccine'] },
  {
    label: 'Keyboard autocorrect replacing a word',
    steps: ['moon landing hoaks', 'moon landing hoax'],
    nextAfter: 'results',
  },
  { label: 'A one-word query with a question mark', steps: ['why?'] },
]

/** US-2 edge cases (semantic route). */
const US2_EDGE_CASES: EdgeCase[] = [
  {
    label: 'A long article title typed in full',
    steps: ['The Lord of the Rings: The Fellowship of the Ring'],
  },
  {
    label: 'A question without a question mark: routes by word count only',
    steps: ['how do cats see in the dark'],
  },
  {
    // Typed after the interleaved list loads: the next pause runs the semantic route.
    label: 'A question mark typed as the last keystroke, changing the route at the pause',
    steps: ['moon landing hoax', 'moon landing hoax?'],
    nextAfter: 'results',
  },
  { label: 'A question mark in the middle of the query', steps: ['pluto? planet status'] },
  {
    label: 'Edited from five words back to four: the list follows the new route',
    steps: ['how was the moon formed', 'how was the moon'],
    nextAfter: 'results',
  },
]

/** US-3 edge cases (interleaved route). */
const US3_EDGE_CASES: EdgeCase[] = [
  {
    // Both retrievers rank "Moon landing conspiracy theories" first.
    label: 'The same page returned by both retrievers',
    steps: ['moon landing hoax'],
  },
  {
    // The fifth word lands once the four-word list is on screen; the next pause
    // replaces it with the semantic list.
    label: 'Crossing a band boundary while typing (four words to five): only the list rendered at the pause counts',
    steps: ['how was the moon', 'how was the moon formed'],
    nextAfter: 'results',
  },
]

/** US-4 edge cases (the result card). */
const US4_EDGE_CASES: EdgeCase[] = [
  {
    // "Mercury" is a disambiguation page: its lead is only "Mercury most commonly refers to:".
    label: 'Disambiguation pages and articles with an empty lead',
    steps: ['mercury'],
  },
  // Another disambiguation page, the first result for its query.
  { label: 'Disambiguation page', steps: ['canton'] },
  {
    // "List of Japanese prefectures by population": the passage comes from a table.
    label: 'A passage drawn from a table or infobox',
    steps: ['population of japanese prefectures table'],
  },
  {
    // "Academy Award for Best Picture": the passage comes from its multiple-winners table.
    label: 'Passage drawn from a table',
    steps: ['academy award for best picture winners list'],
  },
  {
    // "Canton seat" redirects to "Canton (administrative division)".
    label: 'Redirect titles',
    steps: ['canton seat'],
  },
  {
    // "UK" redirects to "United Kingdom", the first result.
    label: 'Redirect title',
    steps: ['UK'],
  },
]

const EDGE_CASE_GROUPS = [
  { title: 'Edge cases US-1', cases: US1_EDGE_CASES },
  { title: 'Edge cases US-2', cases: US2_EDGE_CASES },
  { title: 'Edge cases US-3', cases: US3_EDGE_CASES },
  { title: 'Edge cases US-4', cases: US4_EDGE_CASES },
]

let stopWaiting: WatchStopHandle | null = null
let stepTimer: ReturnType<typeof setTimeout> | undefined

function cancelEdgeCase(): void {
  stopWaiting?.()
  stopWaiting = null
  clearTimeout(stepTimer)
}

function runEdgeCase(edgeCase: EdgeCase): void {
  cancelEdgeCase()
  const [first, next] = edgeCase.steps
  emit('setQuery', first)
  if (!next) return

  if (typeof edgeCase.nextAfter === 'number') {
    stepTimer = setTimeout(() => emit('setQuery', next), edgeCase.nextAfter)
    return
  }

  // Once the first query's list is on screen, the query is edited.
  stopWaiting = watch(
    () => props.listQuery,
    (listQuery) => {
      if (listQuery !== first.trim()) return
      cancelEdgeCase()
      stepTimer = setTimeout(() => emit('setQuery', next), RESULTS_STAY_MS)
    },
    { immediate: true },
  )
}

onBeforeUnmount(cancelEdgeCase)

/* ---------- US-6: fallbacks ---------- */

/** What each retriever does (testPanel.ts); stays set until changed back to Normal. */
const semanticBehaviours = [
  { value: 'normal', label: 'Normal' },
  { value: 'slow', label: `Slower than the ${SEMANTIC_TIMEOUT_MS / 1000} s timeout` },
  // One option: an error, a rate limit and an unavailable backend fall back the same way.
  { value: 'error', label: 'Error, rate limit or unavailable backend' },
  { value: 'empty', label: 'Returns nothing' },
]

const lexicalBehaviours = [
  { value: 'normal', label: 'Normal' },
  { value: 'error', label: 'Error' },
  { value: 'empty', label: 'Returns nothing' },
]

/** What the reader should see with each setting (the other retriever left on Normal). */
const SEMANTIC_EXPECTED: Record<RetrieverBehaviour, string> = {
  normal: 'Semantic and interleaved routes show semantic results as usual.',
  slow: `After ${SEMANTIC_TIMEOUT_MS / 1000} s: the lexical list (interleaved: lexical only). The late semantic results never appear or reorder it.`,
  error: 'The lexical list (interleaved: lexical only), with no error.',
  'rate-limit': 'The lexical list (interleaved: lexical only), with no error.',
  unavailable: 'The lexical list (interleaved: lexical only), with no error.',
  empty: 'The lexical list (interleaved: lexical only). With lexical returning nothing too: the empty state.',
}

const LEXICAL_EXPECTED: Record<RetrieverBehaviour, string> = {
  normal: 'Short queries show lexical results as usual.',
  slow: '',
  error: 'Short queries: the error state. Interleaved: semantic results only. With semantic failing too: the error state.',
  'rate-limit': '',
  unavailable: '',
  empty: 'Short queries: the empty state. Interleaved: semantic results only. With semantic returning nothing too: the empty state.',
}

function resetRetrievers(): void {
  testSettings.semantic = 'normal'
  testSettings.lexical = 'normal'
}

/** The query as typed, with spaces shown, and what EF-1 should decide for it. */
function showQuery(edgeCase: EdgeCase): string {
  return edgeCase.steps.map((text) => `“${text}”`).join(' → ')
}

/** Each step's route, once if they're the same. */
function expectedRoute(edgeCase: EdgeCase): string {
  const routes = edgeCase.steps.map((text) => routeQuery(text.trim()))
  return [...new Set(routes)].join(' → ')
}
</script>

<template>
  <Teleport to="body">
    <aside class="test-panel" aria-label="Test panel">
      <header class="test-panel__header">
        <h2 class="test-panel__title">Test panel</h2>
        <p class="test-panel__note">Desktop only. Not part of the experience.</p>
      </header>

      <section class="test-panel__section">
        <h3 class="test-panel__heading">Current query</h3>
        <dl class="test-panel__readout">
          <dt>Query</dt>
          <dd>{{ query.trim() || '—' }}</dd>
          <dt>Words</dt>
          <dd>{{ words }}</dd>
          <dt>Classifier</dt>
          <dd>{{ classifierRoute ?? 'not classified (not English)' }}</dd>
          <dt>Reason</dt>
          <dd>{{ reason ?? '—' }}</dd>
          <dt>Route in use</dt>
          <dd>{{ routeInUse }}</dd>
        </dl>
      </section>

      <section class="test-panel__section">
        <h3 class="test-panel__heading">Onboarding</h3>
        <p class="test-panel__note">Shown on the first tap on the search field, and again after a refresh.</p>
        <CdxButton @click="emit('showOnboarding')">Show onboarding again</CdxButton>
      </section>

      <section class="test-panel__section">
        <h3 class="test-panel__heading">Connection</h3>
        <CdxToggleButtonGroup v-model="testSettings.connection" :buttons="connectionButtons" />
        <p class="test-panel__note">
          Extra wait per request: lexical
          {{ CONNECTION_DELAYS_MS[testSettings.connection].lexical }} ms, semantic
          {{ CONNECTION_DELAYS_MS[testSettings.connection].semantic }} ms.
        </p>
      </section>

      <section v-for="group in EDGE_CASE_GROUPS" :key="group.title" class="test-panel__section">
        <h3 class="test-panel__heading">{{ group.title }}</h3>
        <ul class="test-panel__cases">
          <li v-for="edgeCase in group.cases" :key="showQuery(edgeCase)" class="test-panel__case">
            <span class="test-panel__case-label">{{ edgeCase.label }}</span>
            <span class="test-panel__case-query">{{ showQuery(edgeCase) }}</span>
            <span class="test-panel__case-row">
              <span class="test-panel__note">Expected: {{ expectedRoute(edgeCase) }}</span>
              <CdxButton size="small" @click="runEdgeCase(edgeCase)">Try</CdxButton>
            </span>
          </li>
        </ul>
      </section>

      <section class="test-panel__section">
        <h3 class="test-panel__heading">US-6</h3>
        <CdxField>
          <template #label>Semantic search</template>
          <CdxSelect v-model:selected="testSettings.semantic" :menu-items="semanticBehaviours" />
          <template #help-text>{{ SEMANTIC_EXPECTED[testSettings.semantic] }}</template>
        </CdxField>
        <CdxField>
          <template #label>Lexical search</template>
          <CdxSelect v-model:selected="testSettings.lexical" :menu-items="lexicalBehaviours" />
          <template #help-text>{{ LEXICAL_EXPECTED[testSettings.lexical] }}</template>
        </CdxField>
        <CdxButton @click="resetRetrievers">Reset to normal</CdxButton>
      </section>
    </aside>
  </Teleport>
</template>

<style scoped>
/* Only where there's room beside the 412px phone column. */
.test-panel {
  display: none;
}

@media (min-width: 1100px) {
  .test-panel {
    position: fixed;
    top: var(--spacing-100, 16px);
    right: var(--spacing-100, 16px);
    bottom: var(--spacing-100, 16px);
    z-index: 100;
    display: flex;
    flex-direction: column;
    gap: var(--spacing-150, 24px);
    box-sizing: border-box;
    width: 320px;
    padding: var(--spacing-100, 16px);
    overflow-y: auto;
    border: var(--border-width-base, 1px) solid var(--border-color-subtle, #c8ccd1);
    border-radius: var(--border-radius-base, 2px);
    background-color: var(--background-color-base, #fff);
    color: var(--color-base, #202122);
    font-family: var(--font-family-system-sans, sans-serif);
    font-size: var(--font-size-small, 14px);
    line-height: var(--line-height-small, 22px);
  }
}

.test-panel__title {
  margin: 0;
  font-size: var(--font-size-large, 18px);
  line-height: var(--line-height-large, 28px);
  font-weight: var(--font-weight-bold, 700);
}

.test-panel__note {
  margin: 0;
  color: var(--color-subtle, #54595d);
}

.test-panel__section {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-75, 12px);
}


/* CdxField brings its own top margin between siblings; the section gap spaces them. */
.test-panel__section :deep(.cdx-field) {
  margin-top: 0;
}

.test-panel__heading {
  margin: 0;
  font-size: var(--font-size-medium, 16px);
  line-height: var(--line-height-medium, 26px);
  font-weight: var(--font-weight-bold, 700);
}

.test-panel__readout {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--spacing-25, 4px) var(--spacing-75, 12px);
  margin: 0;
}

.test-panel__cases {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-75, 12px);
  margin: 0;
  padding: 0;
  list-style: none;
}

.test-panel__case {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-25, 4px);
  margin: 0;
}

.test-panel__case-label {
  color: var(--color-subtle, #54595d);
}

/* `pre` keeps the trailing space visible inside the quotes. */
.test-panel__case-query {
  font-weight: var(--font-weight-bold, 700);
  white-space: pre-wrap;
}

.test-panel__case-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-50, 8px);
}

.test-panel__readout dt {
  color: var(--color-subtle, #54595d);
}

.test-panel__readout dd {
  margin: 0;
  overflow-wrap: anywhere;
}




</style>
