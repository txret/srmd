// compile_html(): the reviewer's controls around a rendered note, with every text of the host escaped.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compile_html } from '../src/reviewer-html.ts'
import { UIConfig } from '../src/config.ts'
import * as tests from './reviewer-html.test.mjs'

/** Note titles, labels and choice texts are escaped as plain text, since a file name may contain markup; the note HTML is kept. */
export function test_texts_are_escaped_and_the_note_html_is_kept() {
  const config = new UIConfig({ show_back: 'Back <', show_front: 'Front >', open_search: 'Search & find', search_hint: 'Search...', do_search: 'Search' })
  const choices = [{ id: 'good', label: 'Good "ok"', detail: '<1 d' }]
  assert.equal(compile_html('review-root', 'a & <b>.sr.md', '<p>Q: <em>x</em></p>', choices, 'good', config), `
<div id="review-root" class="sr-reviewer front" tabindex="0">
  <div class="header">
    <h1 class="title">a &amp; &lt;b&gt;.sr.md</h1>
  </div>
  <div class="content"><p>Q: <em>x</em></p></div>
  <div class="footer">
    <div class="front">
      <button type="button" class="flip-btn">Back &lt;</button>
      <button type="button" class="open-search-btn">Search &amp; find</button>
    </div>
    <div class="back">
      <button type="button" class="flip-btn">Front &gt;</button>
      <button type="button" data-id="good" class="choice-btn default">Good &quot;ok&quot;<span class="detail">&lt;1 d</span></button>

      <button type="button" class="open-search-btn">Search &amp; find</button>
    </div>
    <div class="search"></div>
  </div>
</div>
`.slice(1))
}

/** Notices are escaped paragraphs between the title and the note: a problem text quotes note content, such as a definition. */
export function test_notices_are_escaped_paragraphs_between_title_and_note() {
  const config = new UIConfig({ show_back: 'Back', show_front: 'Front', open_search: 'Search', search_hint: 'Search...', do_search: 'Search' })
  const choices = [{ id: 'good', label: 'Good', detail: '1 d' }]
  assert.equal(compile_html('review-root', 'note', '<p>Q</p>', choices, 'good', config, ['Check <this>:', 'Line 3: {2} & more']), `
<div id="review-root" class="sr-reviewer front" tabindex="0">
  <div class="header">
    <h1 class="title">note</h1>
  </div>
  <div class="notice" role="status"><p>Check &lt;this&gt;:</p><p>Line 3: {2} &amp; more</p></div>
  <div class="content"><p>Q</p></div>
  <div class="footer">
    <div class="front">
      <button type="button" class="flip-btn">Back</button>
      <button type="button" class="open-search-btn">Search</button>
    </div>
    <div class="back">
      <button type="button" class="flip-btn">Front</button>
      <button type="button" data-id="good" class="choice-btn default">Good<span class="detail">1 d</span></button>

      <button type="button" class="open-search-btn">Search</button>
    </div>
    <div class="search"></div>
  </div>
</div>
`.slice(1))
}

// Run every test_ function above as a test named after it.
for (const [name, fn] of Object.entries(tests)) if (name.startsWith('test_')) test(name, fn)
