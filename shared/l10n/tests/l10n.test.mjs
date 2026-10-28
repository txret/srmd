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

/** A host language selects its catalog by language, ignoring case and region; an unknown one selects English. */
export function test_a_host_language_selects_its_catalog_or_english() {
  assert.equal(match_locale('sv'), 'sv')
  assert.equal(match_locale('sv-SE'), 'sv')
  assert.equal(match_locale('SV'), 'sv')
  assert.equal(match_locale('en-US'), 'en')
  assert.equal(match_locale('zh-cn'), 'en')
  assert.equal(match_locale('de'), 'en')
}

/** Messages follow the selected language and insert values verbatim: plain-text hosts get no HTML entities. */
export function test_messages_follow_the_selected_language_and_insert_values_verbatim(t) {
  t.after(() => set_language('en'))
  assert.equal(getLocale(), 'en')
  const messages = () => [
    m.reviewer_again(), m.reviewer_day_range({ min: 3, max: 5 }),
    m.vscode_save_failed({ path: 'a & <b>.sr.md', detail: 'read-only' })
  ]
  assert.deepEqual(messages(), ['Again', '3-5 d', 'Unable to save review for a & <b>.sr.md: read-only'])
  set_language('sv-SE')
  assert.deepEqual(messages(), ['Igen', '3–5 d', 'Kunde inte spara repetitionen för a & <b>.sr.md: read-only'])
  set_language('de')
  assert.deepEqual(messages(), ['Again', '3-5 d', 'Unable to save review for a & <b>.sr.md: read-only'])
}

// Run every test_ function above as a test named after it.
for (const [name, fn] of Object.entries(tests)) if (name.startsWith('test_')) test(name, fn)
