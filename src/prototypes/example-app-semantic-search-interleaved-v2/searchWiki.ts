import { wikimediaApiFetchHeaders, wikiHostFromLang } from '@/config'

const SEARCH_LIMIT = 20
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
  thumbnailUrl: string | null
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

const ANSWER_STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'did', 'do', 'does', 'for', 'from',
  'how', 'in', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'to', 'was', 'were', 'what',
  'when', 'where', 'which', 'who', 'why', 'with',
])

function answerWords(text: string): string[] {
  return (text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(
    (word) => word.length > 2 && !ANSWER_STOPWORDS.has(word),
  )
}

/**
 * Rough "answer" highlight: wrap the snippet sentence sharing the most words with the
 * query in a `<mark>`. Word overlap, not real answer extraction. Drops the snippet's
 * `searchmatch` spans (they're unstyled anyway).
 */
function highlightAnswer(snippetHtml: string, query: string): string {
  const text = snippetHtml.replace(/<[^>]*>/g, '')
  const sentences = text.match(/[^.!?]+(?:[.!?]+|$)/g) ?? [text]
  const queryWords = new Set(answerWords(query))

  let best = -1
  let bestScore = 0
  sentences.forEach((sentence, i) => {
    const score = new Set(answerWords(sentence).filter((word) => queryWords.has(word))).size
    if (score > bestScore) {
      best = i
      bestScore = score
    }
  })
  // No overlap at all: still highlight something, the first full sentence.
  if (best === -1) best = sentences.length > 1 ? 1 : 0

  return sentences
    .map((sentence, i) => {
      if (i !== best) return sentence
      const lead = sentence.match(/^\s*/)?.[0] ?? ''
      return `${lead}<mark class="search-answer">${sentence.slice(lead.length)}</mark>`
    })
    .join('')
}

/**
 * Wrap every word in `passageHtml` that starts with a query keyword in a `<mark>`,
 * so "balti" marks "Baltimore". `passageHtml` must be escaped plain text (no tags).
 */
function highlightKeywords(passageHtml: string, query: string): string {
  const keywords = [...new Set(answerWords(query))]
  if (!keywords.length) return passageHtml

  const pattern = keywords.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  // The `&` lookbehind keeps matches out of HTML entities like `&amp;`.
  const regex = new RegExp(`(?<![&\\p{L}\\p{N}])(?:${pattern})[\\p{L}\\p{N}]*`, 'giu')
  return passageHtml.replace(regex, (match) => `<mark class="search-answer">${match}</mark>`)
}

function highlightIntro(passageHtml: string | null, query: string): string | null {
  return passageHtml ? highlightKeywords(passageHtml, query) : null
}

type SearchPage = {
  pageid?: number
  title?: string
  index?: number
  description?: string
  thumbnail?: { source?: string }
  extract?: string
}

/** First non-empty paragraph of a plain-text extract, as HTML. */
function firstParagraphHtml(extract: string | undefined): string | null {
  const paragraph = extract?.split('\n').find((line) => line.trim().length)
  return paragraph ? escapeHtml(paragraph.trim()) : null
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
          prop: 'pageimages|description|extracts',
          exintro: '1',
          explaintext: '1',
          exlimit: String(SEARCH_LIMIT),
        }
      : { prop: 'pageimages|description' }),
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

  if (!response.ok) return []

  const data = (await response.json()) as {
    query?: { pages?: SearchPage[]; search?: Array<{ pageid?: number; snippet?: string }> }
  }
  const pages = data.query?.pages ?? []
  // Present only when the request also asks for `list=search`.
  const snippets = new Map(
    (data.query?.search ?? []).map((hit) => [
      hit.pageid,
      hit.snippet ? highlightAnswer(hit.snippet, query) : null,
    ]),
  )

  return pages
    .filter(
      (page): page is typeof page & { pageid: number; title: string } =>
        typeof page.pageid === 'number' && typeof page.title === 'string',
    )
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((page) => ({
      pageid: page.pageid,
      source,
      title: page.title,
      titleHtml: highlightPrefixMatch(page.title, query),
      description: page.description ?? '',
      passageHtml:
        passage === 'intro'
          ? highlightIntro(firstParagraphHtml(page.extract), query)
          : (snippets.get(page.pageid) ?? null),
      thumbnailUrl: page.thumbnail?.source ?? null,
    }))
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
      srprop: 'snippet',
      cirrusSemanticSearch: '1',
    },
    'snippet',
    options,
  )
}
