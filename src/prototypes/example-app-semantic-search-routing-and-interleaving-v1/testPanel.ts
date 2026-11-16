/**
 * Test panel state (desktop only, see TestPanel.vue): parameters for trying edge
 * cases. Kept at module level so it holds while moving between the search and article
 * screens; a page refresh starts from the defaults (or `?arm=control` / `?debug=1`).
 */
import { reactive } from 'vue'

import type { SearchRoute } from './routeQuery'
import { SEMANTIC_TIMEOUT_MS, type WikiSearchResult } from './searchWiki'

/**
 * What a retriever does in the test (US-6): answer as usual, find nothing, answer only
 * after the semantic timeout, or fail (an error, a rate limit, an unavailable backend).
 */
export type RetrieverBehaviour =
  | 'normal'
  | 'empty'
  | 'slow'
  | 'error'
  | 'rate-limit'
  | 'unavailable'

/** `slow`: this much longer than the semantic timeout, then the real answer. */
const SLOW_BEYOND_TIMEOUT_MS = 1500

/** Simulated connection: an extra wait before each request, on top of the real one. */
export type ConnectionSpeed = 'fast' | 'medium' | 'slow'

/** Semantic search is the slower retriever, so it waits longer at each speed. */
export const CONNECTION_DELAYS_MS: Record<ConnectionSpeed, { lexical: number; semantic: number }> = {
  fast: { lexical: 0, semantic: 0 },
  medium: { lexical: 400, semantic: 1200 },
  slow: { lexical: 1500, semantic: 4000 },
}

export interface TestSettings {
  arm: 'treatment' | 'control'
  /** `auto` is the EF-1 classifier; the others force one route for every query. */
  route: 'auto' | SearchRoute
  /** Semantic and interleaved routes wait this long after the last keystroke. */
  pauseMs: number
  /** Semantic and interleaved lists are cut to this length. */
  listLength: number
  semantic: RetrieverBehaviour
  lexical: RetrieverBehaviour
  /** To see the skeleton, the as-you-type list under load, and late answers. */
  connection: ConnectionSpeed
  /** Label each card with the retriever that placed it (readers never see this). */
  showLabels: boolean
}

export const DEFAULT_TEST_SETTINGS: Readonly<TestSettings> = {
  arm: 'treatment',
  route: 'auto',
  pauseMs: 600,
  listLength: 20,
  semantic: 'normal',
  lexical: 'normal',
  connection: 'fast',
  showLabels: false,
}

export const testSettings = reactive<TestSettings>({ ...DEFAULT_TEST_SETTINGS })

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'))
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}

/** Runs a retriever under the panel's delay and behaviour settings. */
export async function underTestConditions(
  retriever: 'lexical' | 'semantic',
  run: () => Promise<WikiSearchResult[]>,
  signal?: AbortSignal,
): Promise<WikiSearchResult[]> {
  const delay = CONNECTION_DELAYS_MS[testSettings.connection][retriever]
  if (delay > 0) await wait(delay, signal)

  const behaviour = testSettings[retriever]
  if (behaviour === 'slow') await wait(SEMANTIC_TIMEOUT_MS + SLOW_BEYOND_TIMEOUT_MS, signal)
  if (behaviour === 'error') throw new Error(`Search failed (simulated ${retriever} error).`)
  if (behaviour === 'rate-limit') throw new Error('Search failed (429, simulated rate limit).')
  if (behaviour === 'unavailable') throw new Error('Search failed (503, simulated outage).')
  if (behaviour === 'empty') return []
  return run()
}
