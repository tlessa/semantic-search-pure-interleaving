import { useRoute, useRouter } from 'vue-router'

import { mergedLocationQuery } from '@/appearance/url-query'

/** Navigate to another wiki prototype route, keeping `?title=` and appearance query params. */
export function useWikiPrototypeNavigation() {
  const route = useRoute()
  const router = useRouter()

  function wikiPrototypeLocation(path: string, title: string | null | undefined) {
    const trimmed = title?.trim()
    if (!trimmed?.length) return null
    return {
      path,
      query: mergedLocationQuery(route.query, { title: trimmed }),
    }
  }

  function resolveWikiPrototypeUrl(path: string, title: string | null | undefined): string | null {
    const location = wikiPrototypeLocation(path, title)
    if (!location) return null
    return router.resolve(location).href
  }

  function navigateToWikiPrototype(path: string, title: string | null | undefined): void {
    const location = wikiPrototypeLocation(path, title)
    if (!location) return
    void router.push(location)
  }

  return { navigateToWikiPrototype, resolveWikiPrototypeUrl }
}
