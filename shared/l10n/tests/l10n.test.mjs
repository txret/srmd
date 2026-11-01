// Message catalogs and language selection (ARCHITECTURE.md, "Localization").
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { m, getLocale, locales, match_locale, set_language } from '../src/index.ts'
import * as tests from './l10n.test.mjs'

/** Message keys of one catalog, sorted; `$schema` only names the file format. */
function keys(locale) {
  return Object.keys(JSON.parse(readFileSync(`${import.meta.dirname}/../messages/${locale}.json`, 'utf8')))
    .filter(key => key !== '$schema').sort()
}

/** Every catalog translates exactly the English messages: a missing one falls back to English, an extra one is never compiled. */
export function test_every_catalog_translates_exactly_the_english_messages() {
  for (const locale of locales) assert.deepEqual({ locale, keys: keys(locale) }, { locale, keys: keys('en') })
}

/** A host language selects its catalog by language, ignoring case and region; one without a catalog selects English. */
export function test_a_host_language_selects_its_catalog_or_english() {
  assert.equal(match_locale('en'), 'en')
  assert.equal(match_locale('EN-us'), 'en')
  assert.equal(match_locale('zh-cn'), 'en')
  assert.equal(match_locale('de'), 'en')
}

/**
 * Messages insert values verbatim, so plain-text hosts get no HTML entities, and a language without a catalog shows
 * English.
 */
export function test_messages_insert_values_verbatim_and_fall_back_to_english(t) {
  t.after(() => set_language('en'))
  const messages = () => [
    m.reviewer_again(), m.reviewer_day_range({ min: 3, max: 5 }),
    m.vscode_save_failed({ path: 'a & <b>.sr.md', detail: 'read-only' })
  ]
  assert.equal(getLocale(), 'en')
  assert.deepEqual(messages(), ['Again', '3-5 d', 'Unable to save review for a & <b>.sr.md: read-only'])
  set_language('de')
  assert.deepEqual(messages(), ['Again', '3-5 d', 'Unable to save review for a & <b>.sr.md: read-only'])
}

// Run every test_ function above as a test named after it.
for (const [name, fn] of Object.entries(tests)) if (name.startsWith('test_')) test(name, fn)
