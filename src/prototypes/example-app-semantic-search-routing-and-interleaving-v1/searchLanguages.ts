export interface SearchLanguageOption {
  /** Wikipedia language code (e.g. `en`, `it`). */
  code: string
  /** Language's own-language display name. */
  label: string
}

/** Language tabs shown by default, before the user adds more via "more". */
export const DEFAULT_SEARCH_LANGUAGES: SearchLanguageOption[] = [
  { code: 'en', label: 'English' },
  { code: 'it', label: 'Italiano' },
]

/** Additional languages offered behind the "more" menu. */
export const MORE_SEARCH_LANGUAGES: SearchLanguageOption[] = [
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'pt', label: 'Português' },
  { code: 'ru', label: 'Русский' },
  { code: 'ja', label: '日本語' },
  { code: 'zh', label: '中文' },
  { code: 'ar', label: 'العربية' },
  { code: 'nl', label: 'Nederlands' },
  { code: 'pl', label: 'Polski' },
]

/** Fewest characters a query needs before results are requested. */
const DEFAULT_MIN_QUERY_LENGTH = 3

/** Languages where one character can already be a word. */
const MIN_QUERY_LENGTH_BY_LANG: Record<string, number> = {
  ja: 1,
  zh: 1,
}

/** Minimum query length, in characters, for the `lang` wiki. */
export function minQueryLength(lang: string): number {
  return MIN_QUERY_LENGTH_BY_LANG[lang] ?? DEFAULT_MIN_QUERY_LENGTH
}
