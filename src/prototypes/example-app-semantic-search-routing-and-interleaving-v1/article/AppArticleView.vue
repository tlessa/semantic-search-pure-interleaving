<script setup lang="ts">
/**
 * The article the way the Wikipedia apps show it: the Page Content Service
 * `page/mobile-html` document (with its own app CSS and `pcs.js`) in a frame, as the
 * apps do in a WebView. Like the apps, it hands PCS its setup settings and receives
 * its messages through a `pcsClient` bridge object.
 *
 * The frame is `srcdoc`, so it shares this page's origin: the parent can reach into
 * the article DOM (see `ready`). It grows to fit the article, so the app chrome's
 * own scroll area does the scrolling.
 */
import { onBeforeUnmount, ref, watch } from 'vue'
import { CdxMessage, CdxProgressBar } from '@wikimedia/codex'

import { useIsIos } from '@/composables/useAppPlatform'
import { wikiHostFromLang, wikimediaApiFetchHeaders } from '@/config'
import { globalTheme } from '@/theme'

const props = defineProps<{
  title: string
  lang?: string
  /**
   * Keep the article invisible (the loading bar stays up) while the parent scrolls it
   * into place, e.g. to a search passage: the reader never sees it jump. It keeps its
   * layout meanwhile, so scrolling works.
   */
  concealed?: boolean
}>()

const emit = defineEmits<{
  /** PCS finished its setup (images, collapsed tables): the article DOM is final. */
  ready: [doc: Document]
  /** The reader tapped a link to another article. */
  openArticle: [title: string]
}>()

const isIos = useIsIos()

const frame = ref<HTMLIFrameElement | null>(null)
const srcdoc = ref<string | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const height = ref(0)
/** Hero image above the article. The apps draw it natively, outside the WebView. */
const leadImageUrl = ref<string | null>(null)

let fetchAbort: AbortController | null = null
let resizeObserver: ResizeObserver | null = null

const host = () => wikiHostFromLang(props.lang ?? 'en')

/** PCS adds the `pcs-theme-` / `pcs-platform-` class prefixes itself. */
function pcsTheme(): string {
  return globalTheme.value === 'dark' ? 'dark' : 'default'
}

/** What the apps pass to `pcs.c1.Page.setup`, through `pcsClient.getSetupSettings`. */
function setupSettings(): Record<string, unknown> {
  return {
    platform: isIos.value ? 'ios' : 'android',
    theme: pcsTheme(),
    margins: { top: '16px', right: '16px', bottom: '16px', left: '16px' },
    areTablesInitiallyExpanded: false,
    textSizeAdjustmentPercentage: '100%',
    loadImages: true,
    isEditable: true,
    userGroups: [],
  }
}

/** Widest lead image requested: enough for a phone screen at 3x. */
const LEAD_IMAGE_WIDTH = 1280

/**
 * mobile-html names the lead image in `<meta property="mw:leadImage">` (at a huge
 * size) and leaves room for the app to draw it. Asks for a phone-sized thumbnail
 * when the file is big enough; smaller files keep the URL as given.
 */
function leadImageFrom(html: string): string | null {
  const meta = new DOMParser()
    .parseFromString(html, 'text/html')
    .querySelector('meta[property="mw:leadImage"]')
  const url = meta?.getAttribute('content')
  if (!url) return null
  const fileWidth = Number(meta?.getAttribute('data-file-width'))
  return fileWidth >= LEAD_IMAGE_WIDTH ? url.replace(/\/\d+px-/, `/${LEAD_IMAGE_WIDTH}px-`) : url
}

/**
 * Point relative and protocol-relative URLs at the wiki, and put the bridge first in
 * `<head>` so it exists before `pcs.js` runs.
 */
function prepareDocument(html: string): string {
  const settings = JSON.stringify(JSON.stringify(setupSettings()))
  const bridge =
    '<script>window.pcsClient={' +
    `getSetupSettings:function(){return ${settings}},` +
    'onReceiveMessage:function(m){window.frameElement&&' +
    "window.frameElement.dispatchEvent(new CustomEvent('pcs-message',{detail:m}))}" +
    '};<\/script>'

  return html
    .replace(/<base [^>]*>/, `<base href="https://${host()}/wiki/">`)
    .replace(/<head([^>]*)>/, `<head$1>${bridge}`)
}

async function load(): Promise<void> {
  fetchAbort?.abort()
  fetchAbort = new AbortController()
  const { signal } = fetchAbort

  srcdoc.value = null
  leadImageUrl.value = null
  error.value = null
  loading.value = true
  height.value = 0

  try {
    const path = encodeURIComponent(props.title.replace(/ /g, '_'))
    const response = await fetch(`https://${host()}/api/rest_v1/page/mobile-html/${path}`, {
      signal,
      headers: wikimediaApiFetchHeaders('app-article'),
    })
    if (!response.ok) throw new Error(`Couldn't load the article (${response.status}).`)
    const html = await response.text()
    if (signal.aborted) return
    leadImageUrl.value = leadImageFrom(html)
    srcdoc.value = prepareDocument(html)
  } catch (err) {
    if (signal.aborted) return
    error.value = err instanceof Error ? err.message : "Couldn't load the article."
    loading.value = false
  }
}

function measure(doc: Document): void {
  height.value = Math.ceil(doc.documentElement.getBoundingClientRect().height)
}

function onFrameLoad(): void {
  const doc = frame.value?.contentDocument
  if (!doc?.body) return
  resizeObserver?.disconnect()
  resizeObserver = new ResizeObserver(() => measure(doc))
  resizeObserver.observe(doc.body)
  measure(doc)
}

/** Wiki URL → article title, or null for anything that isn't a plain article link. */
function articleTitleFromUrl(url: URL): string | null {
  if (url.host !== host() || !url.pathname.startsWith('/wiki/')) return null
  const title = decodeURIComponent(url.pathname.slice('/wiki/'.length)).replace(/_/g, ' ')
  return title && !title.includes(':') ? title : null
}

function onLinkClicked(href: string): void {
  const doc = frame.value?.contentDocument
  if (href.startsWith('#')) {
    doc?.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView({ block: 'start' })
    return
  }

  const url = new URL(href, `https://${host()}/wiki/`)
  const title = articleTitleFromUrl(url)
  if (title) emit('openArticle', title)
  else window.open(url.href, '_blank', 'noopener')
}

/**
 * PCS keeps every section after the first `display: none` until a beat after
 * `final_setup`; until then nothing in them can be scrolled to. Wait for that (up to
 * 2 s) before saying the article is ready.
 */
async function announceReady(doc: Document): Promise<void> {
  for (let tries = 0; tries < 40; tries++) {
    const hidden = [...doc.querySelectorAll<HTMLElement>('section')].some(
      (section) => section.style.display === 'none',
    )
    if (!hidden) break
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  loading.value = false
  measure(doc)
  emit('ready', doc)
}

/** PCS messages: the subset the apps act on that matters for a prototype. */
function onPcsMessage(event: Event): void {
  const detail = (event as CustomEvent<string>).detail
  let message: { action?: string; data?: Record<string, unknown> }
  try {
    message = JSON.parse(detail)
  } catch {
    return
  }

  if (message.action === 'final_setup') {
    const doc = frame.value?.contentDocument
    if (doc) void announceReady(doc)
  } else if (message.action === 'link' && typeof message.data?.href === 'string') {
    onLinkClicked(message.data.href)
  }
}

watch(frame, (element, previous) => {
  previous?.removeEventListener('pcs-message', onPcsMessage)
  element?.addEventListener('pcs-message', onPcsMessage)
})

watch(
  () => [props.title, props.lang],
  () => void load(),
  { immediate: true },
)

// Follow the ProtoWiki theme the way the apps follow theirs.
watch(globalTheme, () => {
  const pcs = (frame.value?.contentWindow as (Window & { pcs?: any }) | null)?.pcs
  // Unlike setup, setTheme takes the full class name.
  pcs?.c1?.Page?.setTheme(`pcs-theme-${pcsTheme()}`)
})

onBeforeUnmount(() => {
  fetchAbort?.abort()
  resizeObserver?.disconnect()
})
</script>

<template>
  <div class="app-article-view" :class="{ 'app-article-view--concealed': concealed && !error }">
    <CdxProgressBar v-if="(loading || concealed) && !error" inline aria-label="Loading article" />
    <CdxMessage v-if="error" type="error" class="app-article-view__error">
      {{ error }}
    </CdxMessage>
    <div v-if="leadImageUrl" class="app-article-view__lead-image">
      <img :src="leadImageUrl" :alt="title">
    </div>
    <iframe
      v-if="srcdoc"
      ref="frame"
      class="app-article-view__frame"
      :srcdoc="srcdoc"
      :style="{ height: `${height}px` }"
      :title="title"
      scrolling="no"
      @load="onFrameLoad"
    />
  </div>
</template>

<style scoped>
/* Edge to edge, like the app's WebView: undo the app chrome's side padding. */
.app-article-view {
  margin-inline: calc(-1 * var(--spacing-150, 24px));
}

/* Same shape as ArticleWrapper's app lead image: full width, 16:9, cropped to fill. */
.app-article-view__lead-image {
  aspect-ratio: 16 / 9;
  background-color: var(--background-color-neutral, #eaecf0);
}

.app-article-view__lead-image img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.app-article-view--concealed .app-article-view__lead-image,
.app-article-view--concealed .app-article-view__frame {
  visibility: hidden;
}

.app-article-view__frame {
  display: block;
  width: 100%;
  border: 0;
}

.app-article-view__error {
  margin: var(--spacing-100, 16px) var(--spacing-150, 24px);
}
</style>
