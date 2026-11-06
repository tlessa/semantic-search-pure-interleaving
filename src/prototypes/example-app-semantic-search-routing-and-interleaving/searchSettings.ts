/**
 * Settings → Search → "Search within articles". Off, the search screen is PlainSearch:
 * the template-app-search screen with lexical results only (no passages or Beta row).
 * In memory only: it holds while moving between screens, and any page refresh
 * starts with the feature on again.
 */
import { ref } from 'vue'

export const searchWithinArticles = ref(true)

/**
 * The "Search deeper" onboarding has been seen. Same lifetime: it holds while moving
 * between screens, and a page refresh shows the onboarding again.
 */
export const onboardingSeen = ref(false)
