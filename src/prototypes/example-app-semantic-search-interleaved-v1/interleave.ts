import type { WikiSearchResult } from './searchWiki'

/**
 * Interleave two ranked lists by strict alternation. One coin flip per merge decides
 * which list places first (A, B, A, B, … or B, A, B, A, …). Duplicates are kept, so an
 * article found by both lists can appear twice. When one list runs out, the other
 * fills the rest.
 */
export function interleaveResults(
  a: WikiSearchResult[],
  b: WikiSearchResult[],
  random: () => number = Math.random,
): WikiSearchResult[] {
  const [first, second] = random() < 0.5 ? [a, b] : [b, a]
  const merged: WikiSearchResult[] = []
  const length = Math.max(first.length, second.length)

  for (let i = 0; i < length; i++) {
    if (first[i]) merged.push(first[i])
    if (second[i]) merged.push(second[i])
  }

  return merged
}
