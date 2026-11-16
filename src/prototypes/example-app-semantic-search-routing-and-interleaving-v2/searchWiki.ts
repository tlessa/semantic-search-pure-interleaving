import { wikimediaApiFetchHeaders, wikiHostFromLang } from '@/config'

const SEARCH_LIMIT = 20

/** US-6: semantic results that take longer than this are dropped for the lexical list. */
export const SEMANTIC_TIMEOUT_MS = 2000
const THUMBNAIL_SIZE = 160

export type SearchSource = 'lexical' | 'semantic'

export interface WikiSearchResult {
  pageid: number
  /** Which retriever produced this result. */
  source: SearchSource
  title: string
  /** Title HTML with the matched leading prefix wrapped in `<span class="searchmatch">`. */
  titleHtml: string
  description: string
  /**
   * Passage shown in the card (HTML). Semantic: the matched passage from Special:Search.
   * Lexical: the article's first paragraph.
   */
  passageHtml: string | null
  /** Semantic only: the article section the passage comes from (plain text). */
  sectionTitle: string | null
  /** Semantic only: the phrase in the passage that answers the query (plain text). */
  answerText: string | null
  thumbnailUrl: string | null
  /** Lexical only: the redirect title the search matched, when it led to this article. */
  redirectedFrom: string | null
}

/**
 * `cirrusSemanticSearch=hl` wraps the answering phrase of the passage in `searchmatch`
 * spans. Returns the longest one as plain text. DOMParser keeps the snippet inert.
 */
function answerFromSnippet(snippetHtml: string): string | null {
  const doc = new DOMParser().parseFromString(snippetHtml, 'text/html')
  const spans = [...doc.querySelectorAll('.searchmatch')].map((el) => el.textContent?.trim() ?? '')
  const longest = spans.reduce((best, text) => (text.length > best.length ? text : best), '')
  return longest || null
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Wrap the leading substring of `title` matching `query` in a `searchmatch` span. */
function highlightPrefixMatch(title: string, query: string): string {
  const matchLength = Math.min(query.length, title.length)
  const candidate = title.slice(0, matchLength)

  if (!matchLength || candidate.toLocaleLowerCase() !== query.toLocaleLowerCase()) {
    return escapeHtml(title)
  }

  const rest = title.slice(matchLength)
  return `<span class="searchmatch">${escapeHtml(candidate)}</span>${escapeHtml(rest)}`
}

type SearchPage = {
  pageid?: number
  title?: string
  index?: number
  description?: string
  thumbnail?: { source?: string }
  extract?: string
  /** `disambiguation` is present (as an empty string) on disambiguation pages. */
  pageprops?: { disambiguation?: string }
}

/** Short description shown on disambiguation pages, in place of their own. */
const DISAMBIGUATION_DESCRIPTION = 'This title relates to more than one page'

/** Words too common to mark as keywords. */
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'is', 'it',
  'of', 'on', 'or', 'that', 'the', 'to', 'was', 'were', 'with',
])

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Plain text as HTML, with the query's keywords wrapped in `searchmatch` spans, like
 * the semantic passages' answers. A keyword also matches inside a longer word ("can"
 * in "Canudos"); a single letter only matches as a word of its own.
 */
function highlightKeywords(text: string, query: string): string {
  // Hyphenated words ("covid-19") stay one keyword.
  const words = query.toLocaleLowerCase().match(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu) ?? []
  const keywords = [...new Set(words)].filter((word) => !STOP_WORDS.has(word))
  if (!keywords.length) return escapeHtml(text)

  const alternatives = keywords
    // Longest first, so "moonlight" wins over "moon" when the query has both.
    .sort((a, b) => b.length - a.length)
    .map((word) =>
      word.length > 1
        ? escapeRegExp(word)
        : `(?<![\\p{L}\\p{N}])${escapeRegExp(word)}(?![\\p{L}\\p{N}])`,
    )
  const pattern = new RegExp(alternatives.join('|'), 'giu')
  let html = ''
  let last = 0
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0
    html += `${escapeHtml(text.slice(last, start))}<span class="searchmatch">${escapeHtml(match[0])}</span>`
    last = start + match[0].length
  }
  return html + escapeHtml(text.slice(last))
}

/** First non-empty paragraph of a plain-text extract, as HTML, keywords marked. */
function firstParagraphHtml(extract: string | undefined, query: string): string | null {
  const paragraph = extract?.split('\n').find((line) => line.trim().length)
  return paragraph ? highlightKeywords(paragraph.trim(), query) : null
}

/** Enough page text to fill the card's eight lines, like the other cards. */
const DISAMBIGUATION_TEXT_CHARS = 1000

/**
 * A disambiguation page's lead is often one line ("Canton may refer to:"). Its card
 * text is the lead followed by the meanings listed under it, section headings left
 * out: "Canton may refer to: Canton (administrative division), …; Canton, …".
 * Whole-page extracts come one page per request, so this asks for one page.
 */
async function disambiguationText(
  pageid: number,
  options: { signal?: AbortSignal; lang?: string },
): Promise<string | null> {
  const params = new URLSearchParams({
    action: 'query',
    pageids: String(pageid),
    prop: 'extracts',
    explaintext: '1',
    // Headings as "== Places ==", so they can be told apart and left out.
    exsectionformat: 'wiki',
    exchars: String(DISAMBIGUATION_TEXT_CHARS),
    format: 'json',
    formatversion: '2',
    origin: '*',
  })
  const response = await fetch(
    `https://${wikiHostFromLang(options.lang ?? 'en')}/w/api.php?${params.toString()}`,
    { signal: options.signal, headers: wikimediaApiFetchHeaders('live-search') },
  )
  if (!response.ok) return null

  const data = (await response.json()) as { query?: { pages?: SearchPage[] } }
  const lines = (data.query?.pages?.[0]?.extract ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^=+.*=+$/.test(line))
  if (!lines.length) return null

  // Meanings are separated by "; ", except after a line that introduces them ("…:").
  return lines.reduce((text, line) => `${text}${text.endsWith(':') ? ' ' : '; '}${line}`)
}

/**
 * Run a generator query (with thumbnails + descriptions) and normalise its pages.
 * `passage` picks the card text: the `list=search` snippet the params ask for, or the
 * article's first paragraph (lead extract).
 */
async function fetchPages(
  query: string,
  source: SearchSource,
  generatorParams: Record<string, string>,
  passage: 'snippet' | 'intro',
  options: { signal?: AbortSignal; lang?: string },
): Promise<WikiSearchResult[]> {
  const host = wikiHostFromLang(options.lang ?? 'en')

  const params = new URLSearchParams({
    action: 'query',
    ...generatorParams,
    ...(passage === 'intro'
      ? {
          prop: 'pageimages|description|extracts|pageprops',
          exintro: '1',
          explaintext: '1',
          exlimit: String(SEARCH_LIMIT),
        }
      : { prop: 'pageimages|description|pageprops' }),
    ppprop: 'disambiguation',
    piprop: 'thumbnail',
    pithumbsize: String(THUMBNAIL_SIZE),
    pilicense: 'any',
    format: 'json',
    formatversion: '2',
    origin: '*',
  })

  const response = await fetch(`https://${host}/w/api.php?${params.toString()}`, {
    signal: options.signal,
    headers: wikimediaApiFetchHeaders('live-search'),
  })

  // Rate limits (429) and an unavailable backend (5xx) are failures, not "no results".
  if (!response.ok) throw new Error(`Search failed (${response.status}).`)

  const data = (await response.json()) as {
    query?: {
      pages?: SearchPage[]
      search?: Array<{ pageid?: number; snippet?: string; sectiontitle?: string }>
      /** With `redirects=1`: each redirect the search matched and the article it led to. */
      redirects?: Array<{ index?: number; from: string; to: string }>
    }
  }
  const pages = data.query?.pages ?? []
  // Several redirects can lead to one article: keep the best-ranked one.
  const redirectedFrom = new Map<string, string>()
  for (const redirect of [...(data.query?.redirects ?? [])].sort(
    (a, b) => (a.index ?? 0) - (b.index ?? 0),
  )) {
    if (!redirectedFrom.has(redirect.to)) redirectedFrom.set(redirect.to, redirect.from)
  }
  const sectionTitles = new Map(
    (data.query?.search ?? []).map((hit) => [hit.pageid, hit.sectiontitle || null]),
  )
  const answers = new Map(
    (data.query?.search ?? []).map((hit) => [
      hit.pageid,
      hit.snippet ? answerFromSnippet(hit.snippet) : null,
    ]),
  )
  // Present only when the request also asks for `list=search`.
  const snippets = new Map(
    (data.query?.search ?? []).map((hit) => [hit.pageid, hit.snippet || null]),
  )

  const sorted = pages
    .filter(
      (page): page is typeof page & { pageid: number; title: string } =>
        typeof page.pageid === 'number' && typeof page.title === 'string',
    )
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))

  // First paragraphs: a disambiguation page gets its list of meanings as well.
  const disambiguationTexts = new Map<number, string | null>()
  if (passage === 'intro') {
    await Promise.all(
      sorted
        .filter((page) => page.pageprops?.disambiguation !== undefined)
        .map(async (page) => {
          const text = await disambiguationText(page.pageid, options).catch(() => null)
          disambiguationTexts.set(page.pageid, text)
        }),
    )
  }

  return sorted.map((page) => {
    const disambiguation = disambiguationTexts.get(page.pageid)
    return {
      pageid: page.pageid,
      source,
      title: page.title,
      titleHtml: highlightPrefixMatch(page.title, query),
      description:
        page.pageprops?.disambiguation !== undefined
          ? DISAMBIGUATION_DESCRIPTION
          : (page.description ?? ''),
      passageHtml:
        passage === 'snippet'
          ? (snippets.get(page.pageid) ?? null)
          : disambiguation
            ? highlightKeywords(disambiguation, query)
            : firstParagraphHtml(page.extract, query),
      sectionTitle: passage === 'snippet' ? (sectionTitles.get(page.pageid) ?? null) : null,
      answerText: passage === 'snippet' ? (answers.get(page.pageid) ?? null) : null,
      thumbnailUrl: page.thumbnail?.source ?? null,
      redirectedFrom: redirectedFrom.get(page.title) ?? null,
    }
  })
}

/**
 * Lexical search: prefix/relevance title completion (not exact full-text match) —
 * surfaces the most likely article even from a partial query
 * (e.g. "balti" → "Baltimore"), with short descriptions, thumbnails, and each
 * article's first paragraph. When no title matches (common for questions), falls
 * back to full-text search, as the Wikipedia apps do.
 */
export async function searchWiki(
  query: string,
  options: { signal?: AbortSignal; lang?: string } = {},
): Promise<WikiSearchResult[]> {
  const trimmed = query.trim()
  if (!trimmed.length) return []

  const prefixResults = await fetchPages(
    trimmed,
    'lexical',
    {
      generator: 'prefixsearch',
      gpssearch: trimmed,
      gpslimit: String(SEARCH_LIMIT),
      gpsnamespace: '0',
      // Redirects have no text: show the article they point to, with its paragraph.
      redirects: '1',
    },
    'intro',
    options,
  )
  if (prefixResults.length) return prefixResults

  return fetchPages(
    trimmed,
    'lexical',
    {
      generator: 'search',
      gsrsearch: trimmed,
      gsrlimit: String(SEARCH_LIMIT),
      gsrnamespace: '0',
      redirects: '1',
    },
    'intro',
    options,
  )
}

/** Wikis where semantic search runs; every other wiki gets the lexical list only. */
const SEMANTIC_LANGS = new Set(['en'])

/** Whether the `lang` wiki gets the interleaved semantic + lexical list. */
export function supportsSemanticSearch(lang: string): boolean {
  return SEMANTIC_LANGS.has(lang)
}

/**
 * Semantic search: CirrusSearch full-text search with the `cirrusSemanticSearch`
 * flag — the same results as Special:Search?…&cirrusSemanticSearch. The Action API
 * warns "Unrecognized parameter" but CirrusSearch still honours the flag.
 * `list=search` runs alongside the generator to return each page's matched passage.
 */
export async function searchSemantic(
  query: string,
  options: { signal?: AbortSignal; lang?: string } = {},
): Promise<WikiSearchResult[]> {
  const trimmed = query.trim()
  if (!trimmed.length) return []

  return fetchPages(
    trimmed,
    'semantic',
    {
      generator: 'search',
      gsrsearch: trimmed,
      gsrlimit: String(SEARCH_LIMIT),
      gsrnamespace: '0',
      list: 'search',
      srsearch: trimmed,
      srlimit: String(SEARCH_LIMIT),
      srnamespace: '0',
      srprop: 'snippet|sectiontitle',
      // `hl` also marks the passage's answer with `searchmatch` (see answerFromSnippet).
      cirrusSemanticSearch: 'hl',
    },
    'snippet',
    options,
  )
}
