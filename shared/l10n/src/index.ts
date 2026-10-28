/**
 * Translation for every user-facing text. Paraglide compiles messages/<locale>.json into typed message functions,
 * `m.<key>(inputs)`, in src/paraglide/ (run scripts/compile.mjs first). Keys are prefixed with their component or host.
 */
import { baseLocale, locales, setLocale, type Locale } from './paraglide/runtime.js'

export { m } from './paraglide/messages.js'
export { getLocale, locales, type Locale } from './paraglide/runtime.js'

/** Supported locale for a host language code: an exact match, else its language (`sv-SE` → `sv`), else English. */
export function match_locale(language: string): Locale {
  /* Compare case-insensitively, since hosts spell regional codes differently (VS Code uses `zh-cn`). */
  const code = language.toLowerCase()
  const language_only = code.split('-')[0]
  return locales.find(locale => locale.toLowerCase() === code) ?? locales.find(locale => locale === language_only) ?? baseLocale
}

/** Select the language of every message, e.g. from VS Code's `vscode.env.language`, once at host start-up. */
export function set_language(language: string): void {
  setLocale(match_locale(language), { reload: false })
}
