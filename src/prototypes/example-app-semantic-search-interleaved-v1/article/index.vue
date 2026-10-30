<script setup lang="ts">
// The article a search result opens, rendered like the Wikipedia apps render it
// (Page Content Service mobile-html, see AppArticleView), landing on the passage that
// answered a semantic search (`?answer=`, falling back to `?section=`).
definePage({
  meta: {
    platform: 'app',
    hidden: true,
  },
})

import { computed, onBeforeUnmount, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import AppChromeWrapper from '@/components/app/AppChromeWrapper.vue'
import {
  ANDROID_ARTICLE_BOTTOM_NAV_ITEMS,
  IOS_ARTICLE_BOTTOM_NAV_ITEMS,
  type AppBottomNavItem,
} from '@/components/app/appBottomNavItems'
import type { AppHeaderItem } from '@/components/app/AppChromeHeader.vue'
import { useIsIos } from '@/composables/useAppPlatform'

import FeedbackToast from '../FeedbackToast.vue'
import ArticleFeedbackSheet from './ArticleFeedbackSheet.vue'
import { useArticleFeedback, useFeedbackToast } from '../searchFeedback'
import AppArticleView from './AppArticleView.vue'
import { landOnPassage } from './landOnPassage'
import '../roboto.css'

const route = useRoute()
const router = useRouter()
const isIos = useIsIos()

function queryString(key: string): string | undefined {
  const value = route.query[key]
  return typeof value === 'string' && value.trim().length ? value : undefined
}

const article = computed(() => queryString('article'))
const lang = computed(() => queryString('lang'))

/** The search screen this article was opened from: this route's parent. */
const searchPath = computed(() => route.path.replace(/\/article\/?$/, ''))

/** See searchFeedback.ts. `reactive` so the template reads `articleFeedback.visible` etc. */
const articleFeedback = reactive(useArticleFeedback(article))
const { message: feedbackToast } = useFeedbackToast()

/** Keep `?debug=1` across navigation inside the prototype. */
const debugQuery = computed(() => (route.query.debug ? { debug: route.query.debug } : {}))

function goBack(): void {
  router.back()
}

function goToSearch(): void {
  router.push({ path: searchPath.value, query: debugQuery.value })
}

function onBottomNav(item: AppBottomNavItem): void {
  if (item === 'search' || item === 'article-search') goToSearch()
}

/**
 * Arriving for a passage (`?answer=` / `?section=`), the article stays hidden behind the
 * loading bar until it's scrolled there, so it appears already at the passage. A
 * safety timeout reveals it anyway if the article never finishes setting up.
 */
const LANDING_TIMEOUT_MS = 10000
const landing = ref(Boolean(queryString('answer') || queryString('section')))
const landingTimeout = landing.value
  ? setTimeout(() => (landing.value = false), LANDING_TIMEOUT_MS)
  : undefined
onBeforeUnmount(() => clearTimeout(landingTimeout))

async function onReady(doc: Document): Promise<void> {
  await landOnPassage(doc.body, { answer: queryString('answer'), section: queryString('section') })
  landing.value = false
  clearTimeout(landingTimeout)
  // Landed: the article feedback card's 5 s starts now (if the reader is eligible).
  articleFeedback.onLanded()
}

/** A link inside the article opens that article here, at the top. */
function openArticle(title: string): void {
  landing.value = false
  router.push({ path: route.path, query: { article: title, lang: lang.value, ...debugQuery.value } })
}

const backIcon = computed(() => (isIos.value ? 'previous' : 'arrow-previous'))

const headerLeft = computed((): AppHeaderItem[] => [
  { type: 'button', icon: backIcon.value, label: 'Back', onClick: goBack },
  { type: 'button', icon: 'search', label: 'Search', onClick: goToSearch },
])

const headerMiddle: AppHeaderItem[] = [{ type: 'link', icon: 'logo-wikipedia', label: 'Wikipedia' }]

const headerRight: AppHeaderItem[] = [
  { type: 'button', icon: 'tabs', label: 'Tabs' },
  { type: 'button', icon: 'bell-outline', label: 'Notifications' },
  { type: 'button', icon: 'vertical-ellipsis', label: 'Menu' },
]

const bottomNavItems = computed(() =>
  isIos.value ? IOS_ARTICLE_BOTTOM_NAV_ITEMS : ANDROID_ARTICLE_BOTTOM_NAV_ITEMS,
)
</script>

<template>
  <AppChromeWrapper
    class="semantic-search-roboto"
    :left="headerLeft"
    :middle="headerMiddle"
    :right="headerRight"
    :bottom-nav-items="bottomNavItems"
    @navigate="onBottomNav"
  >
    <AppArticleView
      v-if="article"
      :key="`${lang}:${article}`"
      :title="article"
      :lang="lang"
      :concealed="landing"
      @ready="onReady"
      @open-article="openArticle"
    />

    <!--
      The Dive card: 5 s after landing, only for readers who came from an eligible
      result list and didn't answer there (see searchFeedback.ts).
    -->
    <ArticleFeedbackSheet
      v-model:rating="articleFeedback.rating"
      v-model:comment="articleFeedback.comment"
      :open="articleFeedback.visible"
      :can-submit="articleFeedback.canSubmit"
      @submit="articleFeedback.submit"
      @dismiss="articleFeedback.dismiss"
    />

    <!-- 84px: clears AppBottomMenu. -->
    <FeedbackToast :message="feedbackToast" :bottom-offset="84" />
  </AppChromeWrapper>
</template>
