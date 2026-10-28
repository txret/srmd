// The review tab (ARCHITECTURE.md, "Review and persistence"): cards shown, rated, saved and reloaded, in the mocked
// VS Code of host.mjs.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { start_host, uri, wait_until } from './host.mjs'
import * as tests from './review.test.mjs'

/** Two notes for choosing what to review: in topic/a.sr.md the due second group is served before the new first group. */
const row_notes = {
  'topic/a.sr.md': `
New:: first

Due:: second[:1]

[:1]: k 20261014040000 7 20261007120000 8.5 4.2 0 10 1
`.slice(1),
  'other/c.sr.md': 'Q:: third'
}

/**
 * VS Code keyboard ratings save before the next card and survive a host restart.
 * Rate through both UI inputs, hold the first disk write, then reload only the saved Markdown.
 */
export async function test_ratings_save_before_the_next_card_and_survive_a_restart(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00:00+02:00') })
  const source = `
First:: one

Second:: two`.slice(1)
  const after_first = `
First:: one[:1]

Second:: two

[:1]: l 20261015121000 0 20261015120000 2.3065 2.11810397 1 1 0
`.slice(1)
  const after_second = `
First:: one[:1]

Second:: two[:2]

[:1]: l 20261015121000 0 20261015120000 2.3065 2.11810397 1 1 0
[:2]: k 20261016040000 1 20261015120000 2.3065 2.11810397 0 1 0
`.slice(1)
  const host = await start_host(t, source, {})
  const pending = host.review()
  await wait_until(() => host.panel?.document)
  assert.deepEqual(host.panel.document.active_ordinals(), [1])
  const first_document = host.panel.document

  // The reveal shortcut does not submit; repeated ratings while saving submit only once.
  first_document.press_space()
  assert.deepEqual(host.messages, [{ type: 'ready' }])
  assert.deepEqual(host.files.get('/workspace/topic/a.sr.md'), { text: source, mtime: 1 })
  const finish_write = host.pause_writes()
  try {
    first_document.press_space()
    first_document.press_space()
    await wait_until(() => host.writing)
    assert.deepEqual(host.messages, [{ type: 'ready' }, { type: 'review', id: 1, choice_id: 'good' }])
    assert.equal(host.panel.document, first_document)
    assert.deepEqual(host.files.get('/workspace/topic/a.sr.md'), { text: source, mtime: 1 })
  } finally {
    finish_write()
  }

  // After the save, the scheduler skips the learning card until its exact due time.
  await wait_until(() => host.panel.document !== first_document)
  assert.deepEqual(host.panel.document.active_ordinals(), [2])
  assert.deepEqual(host.files.get('/workspace/topic/a.sr.md'), { text: after_first, mtime: 2 })
  host.panel.reply('tomorrow')
  await pending
  assert.equal(host.panel.disposed, true)
  assert.deepEqual(host.files.get('/workspace/topic/a.sr.md'), { text: after_second, mtime: 3 })
  assert.deepEqual(host.messages, [
    { type: 'ready' },
    { type: 'review', id: 1, choice_id: 'good' },
    { type: 'review', id: 2, choice_id: 'tomorrow' }
  ])
  assert.deepEqual(host.errors, [])
  host.dispose()

  // A fresh extension instance restores both complete records from the saved note.
  const reloaded = await start_host(t, host.files.get('/workspace/topic/a.sr.md').text, {})
  assert.deepEqual(reloaded.state.nodes['topic/a.sr.md'].cards, [
    {
      ref: 1, state: 'l', due: '20261015121000', scheduled_days: 0, last_review: '20261015120000',
      stability: 2.3065, difficulty: 2.11810397, learning_steps: 1, reps: 1, lapses: 0, ordinal: 1
    },
    {
      ref: 2, state: 'k', due: '20261016040000', scheduled_days: 1, last_review: '20261015120000',
      stability: 2.3065, difficulty: 2.11810397, learning_steps: 0, reps: 1, lapses: 0, ordinal: 2
    }
  ])
  await reloaded.review()
  assert.equal(reloaded.panel.disposed, true)
  assert.deepEqual(reloaded.panel.cards, [])
  assert.deepEqual(reloaded.files.get('/workspace/topic/a.sr.md'), { text: after_second, mtime: 1 })
}

/**
 * A failed VS Code review save reports the failure and does not present the next card.
 * Reject the filesystem write after a UI rating and verify the review ends without another card.
 */
export async function test_a_failed_save_is_reported_and_ends_the_review(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00:00+02:00') })
  const source = `
First:: one

Second:: two`.slice(1)
  const host = await start_host(t, source, {})
  host.fail_writes(new Error('Disk is read-only'))
  const before = structuredClone(host.state.nodes['topic/a.sr.md'].cards)
  const pending = host.review()
  await wait_until(() => host.panel?.document)
  const first_document = host.panel.document
  host.panel.reply('good')
  await pending
  assert.deepEqual(host.errors, ['Unable to save review for topic/a.sr.md: Disk is read-only'])
  assert.equal(host.panel.document, first_document)
  assert.equal(host.panel.disposed, true)
  assert.deepEqual(host.files.get('/workspace/topic/a.sr.md'), { text: source, mtime: 1 })
  // Memory commits a rating only after its save, so the unsaved card is still new and served first.
  assert.deepEqual(host.state.nodes['topic/a.sr.md'].cards, before)
  assert.deepEqual(host.state.nodes['topic/a.sr.md'].new.map(card => card.ordinal), [1, 2])
}

/**
 * A note edited while its card is shown is reloaded, and the rating is dropped rather than overwriting the edit.
 * Edit without a watcher report, as when the rating arrives within the watcher's debounce.
 */
export async function test_a_note_edited_while_its_card_is_shown_drops_the_rating(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00:00+02:00') })
  const source = `
First:: one

Second:: two`.slice(1)
  const edited = `
Zero:: new first

First:: one

Second:: two`.slice(1)
  const host = await start_host(t, source, {})
  const pending = host.review()
  await wait_until(() => host.panel?.document)
  const first_document = host.panel.document
  host.files.set('/workspace/topic/a.sr.md', { text: edited, mtime: 2 })
  host.panel.reply('good')
  await wait_until(() => host.panel.document !== first_document)
  const message = 'topic/a.sr.md changed while its card was shown, so the rating was not saved.'
  assert.deepEqual(host.warnings, [[message]])
  assert.deepEqual(host.log, [['warn', message]])
  assert.deepEqual(host.files.get('/workspace/topic/a.sr.md'), { text: edited, mtime: 2 })
  // The next card comes from the edited note, whose first cloze is new.
  assert.equal(host.state.nodes['topic/a.sr.md'].version, edited)
  assert.equal(host.state.nodes['topic/a.sr.md'].cards.length, 3)
  assert.deepEqual(host.panel.document.active_ordinals(), [1])
  host.panel.reply('tomorrow')
  await wait_until(() => host.files.get('/workspace/topic/a.sr.md').mtime === 3)
  assert.deepEqual(host.files.get('/workspace/topic/a.sr.md'), { text: `
Zero:: new first[:1]

First:: one

Second:: two

[:1]: k 20261016040000 1 20261015120000 2.3065 2.11810397 0 1 0
`.slice(1), mtime: 3 })
  host.panel.dispose()
  await pending
}

/**
 * A note edited before the watcher reports it is reloaded before its card is shown.
 * A card from the older text would rate and save the wrong cloze.
 */
export async function test_a_note_edited_before_the_watcher_reports_it_is_reloaded_first(t) {
  const host = await start_host(t, 'First:: one', {})
  const edited = `
Zero:: new first

First:: one`.slice(1)
  host.files.set('/workspace/topic/a.sr.md', { text: edited, mtime: 2 })
  const pending = host.review()
  await wait_until(() => host.panel?.document)
  assert.equal(host.state.nodes['topic/a.sr.md'].version, edited)
  assert.equal(host.state.nodes['topic/a.sr.md'].cards.length, 2)
  assert.deepEqual(host.panel.document.active_ordinals(), [1])
  host.panel.dispose()
  await pending
}

/**
 * Closing an unanswered review resolves the command without changing the note.
 * Close while the host awaits a rating; disposing other listeners must not strand that wait.
 */
export async function test_closing_an_unanswered_review_changes_nothing(t) {
  const source = `
Q:: answer`.slice(1)
  const host = await start_host(t, source, {})
  const pending = host.review()
  await wait_until(() => host.panel?.document)
  host.panel.dispose()
  await pending
  assert.deepEqual(host.messages, [{ type: 'ready' }])
  assert.deepEqual(host.files.get('/workspace/topic/a.sr.md'), { text: source, mtime: 1 })
}

/**
 * Workspace review preserves note whitespace, hides ids, and resolves relative images.
 */
export async function test_a_review_keeps_the_note_whitespace_and_resolves_relative_images(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-24T12:00:00+02:00') })
  const source = `
Question:: answer\x20\x20
next

![diagram](../media/diagram.png)`.slice(1)
  const expected_loaded = source
  const expected_reviewed = `
Question:: answer[:1]\x20\x20
next

![diagram](../media/diagram.png)

[:1]: k 20260925043000 1 20260924120000 2.3065 2.11810397 0 1 0
`.slice(1)
  const host = await start_host(t, source, {
    rollover: '04:30', 'inactive.front': true, 'inactive.back': true
  })
  assert.equal(host.files.get('/workspace/topic/a.sr.md').text, expected_loaded)
  assert.equal(host.state.config.rollover, 16200000)

  const pending = host.review()
  await wait_until(() => host.panel?.document)
  assert.equal(host.panel.webview.html, readFileSync(`${import.meta.dirname}/review-document.html`, 'utf8'))
  assert.deepEqual(host.panel.cards, [{
    type: 'card', id: 1, base: 'https://resources.test/workspace/topic/',
    markup: readFileSync(`${import.meta.dirname}/relative-resources.html`, 'utf8'), ordinal: 1
  }])
  const { base } = host.panel.cards[0]
  assert.equal(new URL('../media/diagram.png', base).href, 'https://resources.test/workspace/media/diagram.png')

  host.panel.reply('tomorrow')
  await pending
  assert.equal(host.files.get('/workspace/topic/a.sr.md').text, expected_reviewed)
}

/**
 * A note created during a review write loads unchanged after that write finishes.
 */
export async function test_a_note_created_during_a_save_loads_after_it(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-24T12:00:00+02:00') })
  const source = `
Q:: answer`.slice(1)
  const new_source = `
New:: answer`.slice(1)
  const expected_reviewed = `
Q:: answer[:1]

[:1]: k 20260925043000 1 20260924120000 2.3065 2.11810397 0 1 0
`.slice(1)
  const expected_new = new_source
  const host = await start_host(t, source, { rollover: '04:30' })
  const pending = host.review('file:///workspace/topic/a.sr.md')
  await wait_until(() => host.panel?.document)

  const finish_write = host.pause_writes()
  try {
    host.panel.reply('tomorrow')
    await wait_until(() => host.writing)
    host.files.set('/workspace/new.sr.md', { text: new_source, mtime: 1 })
    host.changes.fire(uri('/workspace/new.sr.md'))
    await delay(130)
    assert.equal(host.state.nodes['new.sr.md'], undefined)
    assert.equal(host.files.get('/workspace/new.sr.md').text, `
New:: answer`.slice(1))
  } finally {
    finish_write()
  }
  await pending
  await wait_until(() => host.state.nodes['new.sr.md'])
  assert.equal(host.files.get('/workspace/topic/a.sr.md').text, expected_reviewed)
  assert.equal(host.files.get('/workspace/new.sr.md').text, expected_new)
  assert.deepEqual(host.state.nodes['new.sr.md'].cards, [
    {
      ref: -1, state: 'n', due: '0', scheduled_days: 0, last_review: '0', stability: 0,
      difficulty: 0, learning_steps: 0, reps: 0, lapses: 0, ordinal: 1
    }
  ])
}

/**
 * Review selection and saves keep sparse references separate from card ordinals.
 * Review an existing card followed by two implicit new cards, checking each displayed ordinal and save. New
 * definitions join the last root-level definition, here at the top of the note, and that block is sorted.
 */
export async function test_reviews_keep_sparse_references_separate_from_card_ordinals(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00:00+02:00') })
  const source = `
[:42]: k 20261014040000 7 20261007120000 8.5 4.2 0 10 1

Fresh:: first

Known:: second[:42]

Fresh:: third


`.slice(1)
  const host = await start_host(t, source, {})
  const pending = host.review()
  const known_html = readFileSync(`${import.meta.dirname}/sparse-review-known.html`, 'utf8')
  const first_html = readFileSync(`${import.meta.dirname}/sparse-review-first.html`, 'utf8')
  const third_html = readFileSync(`${import.meta.dirname}/sparse-review-third.html`, 'utf8')
  await wait_until(() => host.panel?.document)
  assert.equal(host.panel.cards.at(-1).markup, known_html)
  assert.deepEqual(host.panel.document.active_ordinals(), [2])
  host.panel.reply('tomorrow')
  await wait_until(() => host.panel.cards.length === 2)
  assert.equal(host.panel.cards.at(-1).markup, first_html)
  assert.deepEqual(host.panel.document.active_ordinals(), [1])
  assert.equal(host.files.get('/workspace/topic/a.sr.md').text,
    `
[:1]: k 20261016040000 1 20261015120000 8.5 4.2 0 11 1

Fresh:: first

Known:: second[:1]

Fresh:: third


`.slice(1))
  host.panel.reply('tomorrow')
  await wait_until(() => host.panel.cards.length === 3)
  assert.equal(host.panel.cards.at(-1).markup, third_html)
  assert.deepEqual(host.panel.document.active_ordinals(), [3])
  host.panel.reply('tomorrow')
  await pending
  const expected = `
[:1]: k 20261016040000 1 20261015120000 2.3065 2.11810397 0 1 0
[:2]: k 20261016040000 1 20261015120000 8.5 4.2 0 11 1
[:3]: k 20261016040000 1 20261015120000 2.3065 2.11810397 0 1 0

Fresh:: first[:1]

Known:: second[:2]

Fresh:: third[:3]


`.slice(1)
  assert.equal(host.files.get('/workspace/topic/a.sr.md').text, expected)
  assert.deepEqual(host.state.nodes['topic/a.sr.md'].cards, [
    {
      ref: -1, state: 'k', due: '20261016040000', scheduled_days: 1, last_review: '20261015120000', stability: 2.3065,
      difficulty: 2.11810397, learning_steps: 0, reps: 1, lapses: 0, ordinal: 1
    },
    {
      ref: 42, state: 'k', due: '20261016040000', scheduled_days: 1, last_review: '20261015120000', stability: 8.5,
      difficulty: 4.2, learning_steps: 0, reps: 11, lapses: 1, ordinal: 2
    },
    {
      ref: -3, state: 'k', due: '20261016040000', scheduled_days: 1, last_review: '20261015120000', stability: 2.3065,
      difficulty: 2.11810397, learning_steps: 0, reps: 1, lapses: 0, ordinal: 3
    }
  ])
}

/**
 * A reloaded review document receives the shown card again, and a replaced card cannot rate.
 * Reload the document, then retarget and rate through the replaced card's own controls.
 */
export async function test_a_reloaded_document_gets_the_card_again_and_a_replaced_card_cannot_rate(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00:00+02:00') })
  const host = await start_host(t, row_notes, {})
  host.review(uri('/workspace/other'))
  await wait_until(() => host.panel?.document)
  const shown = host.panel.cards[0]
  host.panel.webview.html = host.panel.webview.html
  await wait_until(() => host.panel.cards.length === 2)
  assert.deepEqual(host.panel.cards[1], shown)
  const replaced = host.panel.document

  host.review_row('topic')
  await wait_until(() => host.panel.cards.length === 3)
  replaced.choose('good')
  await delay(20)
  assert.deepEqual(host.messages, [{ type: 'ready' }, { type: 'ready' }, { type: 'review', id: 1, choice_id: 'good' }])
  assert.deepEqual(host.files.get('/workspace/other/c.sr.md'), { text: 'Q:: third', mtime: 1 })
  assert.deepEqual(host.panel.cards.at(-1).id, 2)
  host.panel.dispose()
}

/**
 * A review whose note vanished without a watcher event closes its tab and reports why.
 * VS Code reports only the folder when a folder is deleted, so the note is still in the tree.
 */
export async function test_a_review_whose_note_vanished_closes_and_says_why(t) {
  const host = await start_host(t, { 'topic/a.sr.md': 'Q:: one' }, {})
  host.files.delete('/workspace/topic/a.sr.md')
  await host.review(uri('/workspace/topic'))
  assert.equal(host.panel.disposed, true)
  assert.deepEqual(host.errors, ['Review stopped: File not found'])
  assert.deepEqual(host.log, [['error', 'Review stopped: File not found']])

  host.files.set('/workspace/b.sr.md', { text: 'Q:: two', mtime: 1 })
  host.changes.fire(uri('/workspace/b.sr.md'))
  await wait_until(() => host.state.nodes['b.sr.md'])
  const first = host.panel
  host.review(uri('/workspace/b.sr.md'))
  await wait_until(() => host.panel !== first && host.panel.document)
  assert.deepEqual(host.panels, ['Review: topic', 'Review: b.sr.md'])
  host.panel.dispose()
}

/**
 * Clicking the interval text inside a choice rates that choice.
 * The click's target is the button's .detail span, not the button.
 */
export async function test_clicking_the_interval_of_a_choice_rates_that_choice(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00:00+02:00') })
  const host = await start_host(t, 'Q:: one', {})
  const pending = host.review()
  await wait_until(() => host.panel?.document)
  host.panel.document.press_space()
  host.panel.document.click_detail('hard')
  await pending
  assert.deepEqual(host.messages, [{ type: 'ready' }, { type: 'review', id: 1, choice_id: 'hard' }])
}

/**
 * Space on a focused rating button is left to the button instead of choosing the default.
 * Keyboard users who focus Hard must not get Good.
 */
export async function test_space_on_a_focused_rating_button_is_left_to_the_button(t) {
  const host = await start_host(t, 'Q:: one', {})
  host.review()
  await wait_until(() => host.panel?.document)
  host.panel.document.press_space()
  assert.equal(host.panel.document.press_space_on('hard'), false)
  await delay(20)
  assert.deepEqual(host.messages, [{ type: 'ready' }])
  host.panel.dispose()
}

/**
 * A held Space flips once and never rates; releasing and pressing again rates.
 * Auto-repeated keydowns are consumed without acting, so holding Space cannot cycle through cards.
 */
export async function test_a_held_space_flips_once_and_never_rates(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00:00+02:00') })
  const host = await start_host(t, 'Q:: one', {})
  const pending = host.review()
  await wait_until(() => host.panel?.document)
  const document = host.panel.document
  document.press_space()
  for (let i = 0; i < 5; i++) document.press_space(true)
  await delay(20)
  assert.deepEqual(host.messages, [{ type: 'ready' }])
  document.press_space()
  await pending
  assert.deepEqual(host.messages, [{ type: 'ready' }, { type: 'review', id: 1, choice_id: 'good' }])
}

/**
 * Each card releases its layout observer when the next card replaces it.
 * Only the shown card observes its content; replaced cards must not keep observers alive.
 */
export async function test_each_card_releases_its_layout_observer(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00:00+02:00') })
  const host = await start_host(t, 'Q:: one\n\nQ:: two\n\nQ:: three', {})
  host.review()
  for (const id of [1, 2, 3]) {
    await wait_until(() => host.panel?.cards.length === id && host.panel.document)
    assert.equal(host.panel.document_observers, 1)
    if (id < 3) host.panel.reply('tomorrow')
  }
  host.panel.dispose()
}

/**
 * Soon and Later save the first day of their range, 3 and 7 days ahead at the 04:30 rollover, when every day is free
 * and the random choice among equal days is the first.
 */
export async function test_soon_and_later_save_the_first_free_day_of_their_range(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-24T12:00:00+02:00') })
  const soon = await start_host(t, 'Q:: answer', { rollover: '04:30' })
  const soon_review = soon.review(uri('/workspace/topic/a.sr.md'))
  await wait_until(() => soon.panel?.document)
  soon.panel.reply('soon')
  await soon_review
  assert.equal(soon.files.get('/workspace/topic/a.sr.md').text, `
Q:: answer[:1]

[:1]: k 20260927043000 3 20260924120000 3 2.11810397 0 1 0
`.slice(1))

  const later = await start_host(t, 'Q:: answer', { rollover: '04:30' })
  const later_review = later.review(uri('/workspace/topic/a.sr.md'))
  await wait_until(() => later.panel?.document)
  later.panel.reply('later')
  await later_review
  assert.equal(later.files.get('/workspace/topic/a.sr.md').text, `
Q:: answer[:1]

[:1]: k 20261001043000 7 20260924120000 7 2.11810397 0 1 0
`.slice(1))
}

/**
 * The optional extensions the settings turn on parse and render notes: with the Foam placeholders an anchor is
 * hidden and a wiki link is text, without them both stay as written.
 */
export async function test_optional_extensions_the_settings_turn_on_render_notes(t) {
  /** The note's HTML in a card's markup, between the content div's tags. */
  const note_html = markup => markup.split('<div class="content">')[1].split('</div>\n  <div class="footer">')[0]

  const with_foam = await start_host(t, 'Q:: [[note|the note]] ^id', { extensions: ['foam-placeholders'] })
  const with_foam_review = with_foam.review()
  await wait_until(() => with_foam.panel?.document)
  assert.equal(note_html(with_foam.panel.cards[0].markup),
    '<p>Q: <span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">the note: note </span></p>')
  with_foam.panel.dispose()
  await with_foam_review

  const without = await start_host(t, 'Q:: [[note|the note]] ^id', { extensions: [] })
  const without_review = without.review()
  await wait_until(() => without.panel?.document)
  assert.equal(note_html(without.panel.cards[0].markup),
    '<p>Q: <span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">[[note|the note]] ^id</span></p>')
  without.panel.dispose()
  await without_review
}

// Run every test_ function above as a test named after it.
for (const [name, fn] of Object.entries(tests)) if (name.startsWith('test_')) test(name, fn)
