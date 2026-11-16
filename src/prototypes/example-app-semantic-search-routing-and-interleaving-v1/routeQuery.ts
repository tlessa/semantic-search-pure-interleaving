/**
 * Experiment 3 (routing): the EF-1 classifier, the Phase 1 English heuristic. Word
 * count plus question-mark detection, no model.
 *
 * - **Questions** (a `?` anywhere) and **five or more words** → semantic only.
 * - **One or two words** → lexical only: as you type, as today.
 * - **Three or four words** → both retrievers, interleaved (the band we don't know).
 *
 * Semantic and interleaved lists wait for a pause or a submit. Only English is
 * routed; other wikis keep today's lexical search.
 */

export type SearchRoute = 'lexical' | 'semantic' | 'interleaved'

/** Logged with every list (EF-3), so routes can be traced to the rules that made them. */
export const CLASSIFIER_VERSION = 'ef-1.1'

const INTERLEAVE_FROM_WORD = 3
const SEMANTIC_FROM_WORD = 5

/** Whitespace-separated words, ignoring leading/trailing space. */
export function countWords(query: string): number {
  const trimmed = query.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

export function isQuestion(query: string): boolean {
  return query.includes('?')
}

export type RouteReason = 'question-mark' | 'word-count'

/** Why `routeQuery` chose its route (EF-3): a `?` wins over the word count. */
export function routeReason(query: string): RouteReason {
  return isQuestion(query) ? 'question-mark' : 'word-count'
}

/** Which retriever(s) an English query goes to. */
export function routeQuery(query: string): SearchRoute {
  if (isQuestion(query)) return 'semantic'
  const words = countWords(query)
  if (words >= SEMANTIC_FROM_WORD) return 'semantic'
  if (words >= INTERLEAVE_FROM_WORD) return 'interleaved'
  return 'lexical'
}

/** Conformance cases for `routeQuery`: query → expected route. */
export const ROUTE_CONFORMANCE_CASES: Array<[string, SearchRoute]> = [
  ['moon', 'lexical'],
  ['  moon  ', 'lexical'],
  ['the moon', 'lexical'],
  ['moon?', 'semantic'],
  ['why moon?', 'semantic'],
  ['moon landing hoax', 'interleaved'],
  ['first moon landing date', 'interleaved'],
  ['how was the moon formed', 'semantic'],
  ['how was the moon formed?', 'semantic'],
  ['moon   landing    hoax', 'interleaved'],
  ['', 'lexical'],
]
