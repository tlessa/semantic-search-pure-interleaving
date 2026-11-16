import { reactive, watch, type Ref } from 'vue'

import { fetchAttributionSignals } from '@/components/attribution/fetchAttributionSignals'
import { wikiHostFromLang } from '@/config'

import type { WikiSearchResult } from './searchWiki'

export interface ResultSignals {
  contributors: number | null
  references: number | null
}

/**
 * Contributor and reference counts for each search result, from the Attribution API.
 * Fetched after the list renders (one request per article, cached by lang + title)
 * so the counts never hold up the results. Missing counts stay null.
 */
export function useResultSignals(results: Ref<WikiSearchResult[]>, lang: Ref<string>) {
  const signals = reactive(new Map<string, ResultSignals>())
  let abort: AbortController | null = null

  function key(title: string): string {
    return `${lang.value}:${title}`
  }

  watch(results, (list) => {
    abort?.abort()
    abort = new AbortController()
    const { signal } = abort
    const host = wikiHostFromLang(lang.value)

    const titles = [...new Set(list.map((result) => result.title))].filter(
      (title) => !signals.has(key(title)),
    )

    for (const title of titles) {
      const cacheKey = key(title)
      fetchAttributionSignals(title, { host, signal, expand: ['trust_and_relevance'] })
        .then((attribution) => {
          const trust = attribution.trust_and_relevance
          signals.set(cacheKey, {
            contributors: trust?.contributor_counts ?? null,
            references: trust?.reference_count ?? null,
          })
        })
        .catch(() => {
          // Aborted or unavailable: leave uncached so a later list can retry.
        })
    }
  })

  function signalsFor(result: WikiSearchResult): ResultSignals | undefined {
    return signals.get(key(result.title))
  }

  return { signalsFor }
}
