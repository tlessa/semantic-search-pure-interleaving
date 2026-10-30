/**
 * Settings → Search → "Search within articles". Off, the search screen is PlainSearch:
 * the template-app-search screen with lexical results only (no passages, Beta row or
 * feedback).
 * In memory only: it holds while moving between screens, and any page refresh
 * starts with the feature on again.
 */
import { ref } from 'vue'

export const searchWithinArticles = ref(true)
