<script setup lang="ts">
// App settings, reached from "Turn off feature" in the search info sheet. Figma
// 10066:25860: the Android app's Settings screen (rows measured from its screenshot)
// with the new "Search" section at the end (built from the Figma frame).
definePage({
  meta: {
    platform: 'app',
    hidden: true,
  },
})

import { nextTick, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { CdxIcon } from '@wikimedia/codex'
import { cdxIconArrowPrevious } from '@wikimedia/codex-icons'

import MobileWrapper from '@/components/MobileWrapper.vue'

import experimentIcon from '../assets/experiment.svg'
import openInNewIcon from '../assets/open-in-new.svg'
import '../roboto.css'
import { searchWithinArticles } from '../searchSettings'

const route = useRoute()
const router = useRouter()

/** Local to this screen: the prototype doesn't act on these. */
const collapseTables = ref(true)
const toggles = reactive({
  collectionSyncing: false,
  downloadCollectionArticles: true,
  downloadOnlyOverWifi: false,
  showImages: true,
  preferOfflineContent: true,
})

type ToggleKey = keyof typeof toggles

interface SettingsRow {
  title: string
  summary?: string
  /** A switch bound to `toggles[toggle]`. */
  toggle?: ToggleKey
  /** Opens outside the app: the open-in-new icon on the right. */
  external?: boolean
}

/** The rest of the app's Settings, after Search (from the Android app). */
const MORE_SECTIONS: Array<{ title: string; rows: SettingsRow[] }> = [
  {
    title: 'Syncing',
    rows: [
      {
        title: 'Collection syncing',
        summary:
          'Sync collections across different devices by saving them to your Wikipedia account "Tlessa"',
        toggle: 'collectionSyncing',
      },
      { title: 'Download collection articles', toggle: 'downloadCollectionArticles' },
    ],
  },
  {
    title: 'Data usage',
    rows: [
      { title: 'Download only over Wi-Fi', toggle: 'downloadOnlyOverWifi' },
      {
        title: 'Show images',
        summary:
          'Enable or disable loading of images in pages. Uncheck this setting if your Internet connection is slow, or if your data plan is limited.',
        toggle: 'showImages',
      },
      {
        title: 'Prefer offline content',
        summary:
          'Save data usage by loading articles that are available offline rather than always loading the latest version of an article',
        toggle: 'preferOfflineContent',
      },
    ],
  },
  {
    title: 'About',
    rows: [
      { title: 'About the Wikipedia app' },
      { title: 'Send app feedback', external: true },
      { title: 'Wikipedia App FAQ', external: true },
    ],
  },
]

function goBack(): void {
  router.back()
}

const searchSection = ref<HTMLElement | null>(null)
const searchSwitch = ref<HTMLButtonElement | null>(null)

/**
 * The router keeps the previous screen's scroll, so start at the top. From "Turn off
 * feature" (`#search-within-articles`), scroll the Search section up under the sticky
 * header (its scroll-margin-top) and put focus on its switch. Smooth, unless the
 * reader prefers reduced motion.
 */
onMounted(async () => {
  await nextTick()
  window.scrollTo(0, 0)
  if (route.hash !== '#search-within-articles') return
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  searchSection.value?.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' })
  searchSwitch.value?.focus({ preventScroll: true })
})

/** Templates can't assign to an imported ref, so the switch toggles it here. */
function toggleSearchWithinArticles(): void {
  searchWithinArticles.value = !searchWithinArticles.value
}
</script>

<template>
  <MobileWrapper>
    <div class="app-settings semantic-search-roboto">
      <header class="app-settings__header">
        <button type="button" class="app-settings__back" aria-label="Back" @click="goBack">
          <CdxIcon :icon="cdxIconArrowPrevious" />
        </button>
        <h1 class="app-settings__title">
          Settings
        </h1>
      </header>

      <div class="app-settings__row">
        <div class="app-settings__text">
          <span class="app-settings__row-title">Collapse tables</span>
          <span class="app-settings__row-summary">
            Automatically collapse tables in articles, such as infoboxes, references, and notes.
          </span>
        </div>
        <button
          type="button"
          role="switch"
          class="app-settings__switch"
          :aria-checked="collapseTables"
          aria-label="Collapse tables"
          @click="collapseTables = !collapseTables"
        >
          <span class="app-settings__switch-handle" />
        </button>
      </div>

      <div class="app-settings__row">
        <div class="app-settings__text">
          <span class="app-settings__row-title">App theme</span>
          <span class="app-settings__row-summary">Light</span>
        </div>
      </div>

      <div class="app-settings__row">
        <div class="app-settings__text">
          <span class="app-settings__row-title">Editing preference</span>
          <span class="app-settings__row-summary">Visual editing</span>
        </div>
      </div>

      <h2 class="app-settings__section">
        Recommendations
      </h2>
      <div class="app-settings__row">
        <div class="app-settings__text">
          <span class="app-settings__row-title">Discover collection</span>
          <span class="app-settings__row-summary">
            Discover is on. Wikipedia will recommend you articles to read.
          </span>
        </div>
      </div>

      <h2 class="app-settings__section">
        Donations
      </h2>
      <div class="app-settings__row">
        <div class="app-settings__text">
          <span class="app-settings__row-title">Donation reminders</span>
          <span class="app-settings__row-summary">
            Donation reminders are on. Wikipedia will remind you to donate €25 every 5
            articles you read while this experiment runs.
          </span>
        </div>
      </div>
      <div class="app-settings__row">
        <div class="app-settings__text">
          <span class="app-settings__row-title">Clear donation history</span>
        </div>
      </div>

      <!-- The new section, Figma frame 10066:25862. -->
      <section
        id="search-within-articles"
        ref="searchSection"
        class="app-settings__search"
        aria-labelledby="app-settings-search-title"
      >
        <h2 id="app-settings-search-title" class="app-settings__search-title">
          Search
        </h2>
        <div class="app-settings__search-item">
          <span class="app-settings__beta-badge">
            <img :src="experimentIcon" alt="" width="16" height="16">
            Beta
          </span>
          <div class="app-settings__search-row">
            <div class="app-settings__search-text">
              <span class="app-settings__search-name">Search within articles</span>
              <span class="app-settings__search-summary">
                Some results include passages drawn from articles that people researched,
                wrote, and edited.
              </span>
            </div>
            <button
              type="button"
              role="switch"
              class="app-settings__switch"
              ref="searchSwitch"
              :aria-checked="searchWithinArticles"
              aria-label="Search within articles"
              @click="toggleSearchWithinArticles"
            >
              <span class="app-settings__switch-handle" />
            </button>
          </div>
        </div>
      </section>

      <template v-for="section in MORE_SECTIONS" :key="section.title">
        <h2 class="app-settings__section">
          {{ section.title }}
        </h2>
        <div v-for="row in section.rows" :key="row.title" class="app-settings__row">
          <div class="app-settings__text">
            <span class="app-settings__row-title">{{ row.title }}</span>
            <span v-if="row.summary" class="app-settings__row-summary">{{ row.summary }}</span>
          </div>
          <button
            v-if="row.toggle"
            type="button"
            role="switch"
            class="app-settings__switch"
            :aria-checked="toggles[row.toggle]"
            :aria-label="row.title"
            @click="toggles[row.toggle] = !toggles[row.toggle]"
          >
            <span class="app-settings__switch-handle" />
          </button>
          <span
            v-else-if="row.external"
            class="app-settings__external"
            :style="{ '--icon': `url(${JSON.stringify(openInNewIcon)})` }"
            aria-hidden="true"
          />
        </div>
      </template>
    </div>
  </MobileWrapper>
</template>

<style scoped>
.app-settings {
  min-height: 100dvh;
  padding-bottom: var(--spacing-100, 16px);
  box-sizing: border-box;
  background-color: var(--background-color-base, #fff);
  color: var(--color-base, #202122);
}

/* 60px bar: back arrow 16px in, title at 52px. */
/* Stays on top while the settings scroll under it. */
.app-settings__header {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  height: 60px;
  padding-inline: var(--spacing-100, 16px);
  background-color: var(--background-color-base, #fff);
}

/* 24px icon; the ::before grows the tap area without moving anything. */
.app-settings__back {
  position: relative;
  display: flex;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  cursor: pointer;
}

.app-settings__back::before {
  content: '';
  position: absolute;
  inset: -12px;
}

.app-settings__back .cdx-icon {
  width: 24px;
  min-width: 24px;
  height: 24px;
  color: inherit;
}

.app-settings__title {
  margin: 0 0 0 12px;
  font-family: inherit;
  font-size: 22px;
  line-height: 28px;
  font-weight: 500;
}

/* Rows from the screenshot: 16px titles, 14px summaries, 12px above and below. */
.app-settings__row {
  display: flex;
  align-items: center;
  gap: var(--spacing-100, 16px);
  padding: 12px var(--spacing-100, 16px);
}

.app-settings__text {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  flex-direction: column;
}

.app-settings__row-title {
  font-size: 16px;
  line-height: 24px;
}

.app-settings__row-summary {
  color: var(--color-subtle, #54595d);
  font-size: 14px;
  line-height: 18px;
}

/* Open-in-new icon (the Figma SVG as a mask), in the summary grey like the app. */
.app-settings__external {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  background-color: var(--color-subtle, #54595d);
  mask: var(--icon) center / contain no-repeat;
  -webkit-mask: var(--icon) center / contain no-repeat;
}

.app-settings__section {
  margin: 0;
  padding: 24px var(--spacing-100, 16px) 8px;
  color: var(--color-progressive, #36c);
  font-family: inherit;
  font-size: 14px;
  line-height: 16px;
  font-weight: 500;
}

/* Figma frame: 16px padding, "Search" heading, 24px, then the Beta item. */
.app-settings__search {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-150, 24px);
  padding: var(--spacing-100, 16px);
  /* Scrolled to from "Turn off feature": stop just under the 60px sticky header. */
  scroll-margin-top: 60px;
}

/* Same text style as the other section headings (Figma had 11px semibold). */
.app-settings__search-title {
  margin: 0;
  color: var(--color-progressive, #36c);
  font-family: inherit;
  font-size: 14px;
  line-height: 16px;
  font-weight: 500;
}

.app-settings__search-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--spacing-25, 4px);
}

/* Same badge as the search screen's Beta row. */
.app-settings__beta-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-12, 2px);
  box-sizing: border-box;
  height: 20px;
  padding-inline: var(--spacing-25, 4px);
  border: 1px solid var(--border-color-muted, #eaecf0);
  border-radius: var(--border-radius-pill, 9999px);
  font-size: 11px;
  line-height: 16px;
  font-weight: 500;
  letter-spacing: 0.5px;
}

.app-settings__search-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-50, 8px);
  width: 100%;
}

.app-settings__search-text {
  display: flex;
  flex: 1 1 0;
  min-width: 0;
  flex-direction: column;
}

.app-settings__search-name {
  overflow: hidden;
  font-size: 14px;
  line-height: 22px;
  letter-spacing: 0.25px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-settings__search-summary {
  color: var(--color-subtle, #54595d);
  font-size: 12px;
  line-height: 16px;
  letter-spacing: 0.4px;
}

/* Material switch, 52 × 32: on = progressive track, white handle on the right. */
.app-settings__switch {
  position: relative;
  flex-shrink: 0;
  box-sizing: border-box;
  width: 52px;
  height: 32px;
  padding: 0;
  border: 2px solid #79747e;
  border-radius: 16px;
  background-color: var(--background-color-interactive-subtle, #f8f9fa);
  cursor: pointer;
  transition:
    background-color 150ms ease-out,
    border-color 150ms ease-out;
}

.app-settings__switch-handle {
  position: absolute;
  top: 50%;
  left: 6px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background-color: #79747e;
  transform: translateY(-50%);
  transition:
    left 150ms ease-out,
    width 150ms ease-out,
    height 150ms ease-out;
}

.app-settings__switch[aria-checked='true'] {
  border-color: var(--background-color-progressive, #36c);
  background-color: var(--background-color-progressive, #36c);
}

.app-settings__switch[aria-checked='true'] .app-settings__switch-handle {
  left: 22px;
  width: 24px;
  height: 24px;
  background-color: #fff;
}

@media (prefers-reduced-motion: reduce) {
  .app-settings__switch,
  .app-settings__switch-handle {
    transition: none;
  }
}
</style>
