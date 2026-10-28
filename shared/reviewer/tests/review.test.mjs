// Review preparation and round trips (ARCHITECTURE.md, "Reviewer and UI"): load, prepare, rate, save and reload.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Scheduler } from '../../scheduler/src/index.ts'
import { parse, serialize } from '../../parser/src/index.ts'
import { set_language } from '../../l10n/src/index.ts'
import { note_from_parse, prepare_review, review_rating } from '../src/index.ts'
import * as tests from './review.test.mjs'

/** A scheduler with an empty workspace; each test inserts its own notes. */
function make_scheduler() {
  const scheduler = new Scheduler()
  scheduler.load('/workspace')
  return scheduler
}

/**
 * Card ordinals and stored references are independent through load, review, save and reload: the second card,
 * reference 42, is reviewed by ordinal and saved as reference 1, and the definitions keep every field. The review
 * data holds the note's HTML and choices with previewed intervals, translated, without changing the cards.
 */
export function test_ordinals_and_references_stay_independent_through_a_review(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00:00+02:00') })
  const source = `
[:42]: k 20261014040000 7 20261007120000 8.5 4.2 0 10 1

Fresh:: first

Known:: second[:42]

Other:: third[:7]


[:7]: k 20261014040000 3 20261011120000 12.5 5.1 0 20 2\t

\x20`.slice(1)
  const scheduler = make_scheduler()
  const parsed = parse(source)
  const { note, scheduling_changed } = scheduler.create_note('note.sr.md', parsed.scheduling)
  scheduler.update([], [note])
  assert.equal(scheduling_changed, false)
  assert.deepEqual(note.cards, [
    {
      ref: -1, state: 'n', due: '0', scheduled_days: 0, last_review: '0', stability: 0,
      difficulty: 0, learning_steps: 0, reps: 0, lapses: 0, ordinal: 1
    },
    {
      ref: 42, state: 'k', due: '20261014040000', scheduled_days: 7, last_review: '20261007120000', stability: 8.5,
      difficulty: 4.2, learning_steps: 0, reps: 10, lapses: 1, ordinal: 2
    },
    {
      ref: 7, state: 'k', due: '20261014040000', scheduled_days: 3, last_review: '20261011120000', stability: 12.5,
      difficulty: 5.1, learning_steps: 0, reps: 20, lapses: 2, ordinal: 3
    }
  ])
  assert.deepEqual(scheduler.next_card('note.sr.md'), ['note.sr.md', 2])

  const before_preview = structuredClone(note.cards)
  assert.deepEqual(prepare_review(scheduler, note.path, 2, parsed), {
    path: 'note.sr.md',
    title: 'note.sr.md',
    html: `
<p>Fresh: <span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">first</span></p>
<p>Known: <span class="cloze" data-ordinal="2" data-card="[:42]: k 20261014040000 7 20261007120000 8.5 4.2 0 10 1">second</span></p>
<p>Other: <span class="cloze" data-ordinal="3" data-card="[:7]: k 20261014040000 3 20261011120000 12.5 5.1 0 20 2">third</span></p>
`.slice(1),
    card_ordinal: 2,
    choices: [
      { id: 'again', label: 'Again', detail: '10 min' },
      { id: 'hard', label: 'Hard', detail: '21 d' },
      { id: 'good', label: 'Good', detail: '29 d' },
      { id: 'easy', label: 'Easy', detail: '48 d' },
      { id: 'tomorrow', label: 'Tomorrow', detail: '1 d' },
      { id: 'soon', label: 'Soon', detail: '3-5 d' },
      { id: 'later', label: 'Later', detail: '7-21 d' }
    ],
    notices: []
  })
  assert.deepEqual(note.cards, before_preview)
  set_language('sv')
  t.after(() => set_language('en'))
  assert.deepEqual(prepare_review(scheduler, note.path, 2, parsed).choices, [
    { id: 'again', label: 'Igen', detail: '10 min' },
    { id: 'hard', label: 'Svårt', detail: '21 d' },
    { id: 'good', label: 'Bra', detail: '29 d' },
    { id: 'easy', label: 'Lätt', detail: '48 d' },
    { id: 'tomorrow', label: 'I morgon', detail: '1 d' },
    { id: 'soon', label: 'Snart', detail: '3–5 d' },
    { id: 'later', label: 'Senare', detail: '7–21 d' }
  ])
  set_language('en')

  scheduler.review(note.path, 2, review_rating('tomorrow'))
  assert.deepEqual(note.cards, [
    {
      ref: -1, state: 'n', due: '0', scheduled_days: 0, last_review: '0', stability: 0,
      difficulty: 0, learning_steps: 0, reps: 0, lapses: 0, ordinal: 1
    },
    {
      ref: 42, state: 'k', due: '20261016040000', scheduled_days: 1, last_review: '20261015120000', stability: 8.5,
      difficulty: 4.2, learning_steps: 0, reps: 11, lapses: 1, ordinal: 2
    },
    {
      ref: 7, state: 'k', due: '20261014040000', scheduled_days: 3, last_review: '20261011120000', stability: 12.5,
      difficulty: 5.1, learning_steps: 0, reps: 20, lapses: 2, ordinal: 3
    }
  ])
  assert.deepEqual(scheduler.next_card('note.sr.md'), ['note.sr.md', 3])

  const saved = serialize(parsed, note.cards)
  assert.equal(saved, `
[:1]: k 20261016040000 1 20261015120000 8.5 4.2 0 11 1

Fresh:: first

Known:: second[:1]

Other:: third[:2]


[:2]: k 20261014040000 3 20261011120000 12.5 5.1 0 20 2\t

\x20`.slice(1))
  const reloaded = parse(saved)
  const { note: reloaded_note, scheduling_changed: reload_changed } = scheduler.create_note(note.path, reloaded.scheduling)
  assert.equal(reload_changed, false)
  assert.equal(serialize(reloaded, reloaded_note.cards), saved)
  assert.deepEqual(reloaded_note.cards, [
    {
      ref: -1, state: 'n', due: '0', scheduled_days: 0, last_review: '0', stability: 0,
      difficulty: 0, learning_steps: 0, reps: 0, lapses: 0, ordinal: 1
    },
    {
      ref: 1, state: 'k', due: '20261016040000', scheduled_days: 1, last_review: '20261015120000', stability: 8.5,
      difficulty: 4.2, learning_steps: 0, reps: 11, lapses: 1, ordinal: 2
    },
    {
      ref: 2, state: 'k', due: '20261014040000', scheduled_days: 3, last_review: '20261011120000', stability: 12.5,
      difficulty: 5.1, learning_steps: 0, reps: 20, lapses: 2, ordinal: 3
    }
  ])
}

/**
 * After a new card is rated with FSRS and saved with sparse references, the reload keeps it, and the next new card,
 * still without a reference, is reviewable and saved as reference 3.
 */
export function test_a_new_card_after_sparse_references_is_reviewed_and_saved(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00:00+02:00') })
  const scheduler = make_scheduler()
  const parsed = parse(`
Fresh:: first

Known:: second[:8]

Fresh:: third

[:8]: k 20261020040000 7 20261013120000 10 5 0 3 0
`.slice(1))
  const { note } = scheduler.create_note('note.sr.md', parsed.scheduling)
  scheduler.update([], [note])
  assert.deepEqual(scheduler.next_card(note.path), [note.path, 1])
  scheduler.review(note.path, 1, review_rating('good'))
  const first_save = serialize(parsed, note.cards)
  assert.equal(first_save, `
Fresh:: first[:1]

Known:: second[:2]

Fresh:: third

[:1]: l 20261015121000 0 20261015120000 2.3065 2.11810397 1 1 0
[:2]: k 20261020040000 7 20261013120000 10 5 0 3 0
`.slice(1))

  const reloaded = parse(first_save)
  const { note: reloaded_note } = scheduler.create_note(note.path, reloaded.scheduling)
  assert.deepEqual(reloaded_note.cards, [
    {
      ref: 1, state: 'l', due: '20261015121000', scheduled_days: 0, last_review: '20261015120000', stability: 2.3065,
      difficulty: 2.11810397, learning_steps: 1, reps: 1, lapses: 0, ordinal: 1
    },
    {
      ref: 2, state: 'k', due: '20261020040000', scheduled_days: 7, last_review: '20261013120000', stability: 10,
      difficulty: 5, learning_steps: 0, reps: 3, lapses: 0, ordinal: 2
    },
    {
      ref: -3, state: 'n', due: '0', scheduled_days: 0, last_review: '0', stability: 0,
      difficulty: 0, learning_steps: 0, reps: 0, lapses: 0, ordinal: 3
    }
  ])
  scheduler.update([], [reloaded_note])
  assert.deepEqual(scheduler.next_card(note.path), [note.path, 3])
  scheduler.review(note.path, 3, 'tomorrow')
  const second_save = serialize(reloaded, reloaded_note.cards)
  assert.equal(second_save, `
Fresh:: first[:1]

Known:: second[:2]

Fresh:: third[:3]

[:1]: l 20261015121000 0 20261015120000 2.3065 2.11810397 1 1 0
[:2]: k 20261020040000 7 20261013120000 10 5 0 3 0
[:3]: k 20261016040000 1 20261015120000 2.3065 2.11810397 0 1 0
`.slice(1))
  assert.deepEqual(scheduler.create_note(note.path, parse(second_save).scheduling).note.cards, [
    {
      ref: 1, state: 'l', due: '20261015121000', scheduled_days: 0, last_review: '20261015120000', stability: 2.3065,
      difficulty: 2.11810397, learning_steps: 1, reps: 1, lapses: 0, ordinal: 1
    },
    {
      ref: 2, state: 'k', due: '20261020040000', scheduled_days: 7, last_review: '20261013120000', stability: 10,
      difficulty: 5, learning_steps: 0, reps: 3, lapses: 0, ordinal: 2
    },
    {
      ref: 3, state: 'k', due: '20261016040000', scheduled_days: 1, last_review: '20261015120000', stability: 2.3065,
      difficulty: 2.11810397, learning_steps: 0, reps: 1, lapses: 0, ordinal: 3
    }
  ])
}

/** Comments in the old CARDS format are ordinary HTML: they supply no scheduling, and saving keeps them as written. */
export function test_legacy_cards_comments_supply_no_scheduling() {
  const scheduler = make_scheduler()
  const parsed = parse(`
Q:: answer[:7]

<!-- CARDS
[7:k:20261014040000:7:20261007120000:8.5:4.2:0:10:1]
-->
`.slice(1))
  const { note, scheduling_changed } = scheduler.create_note('note.sr.md', parsed.scheduling)
  assert.equal(scheduling_changed, false)
  assert.deepEqual(note.cards, [{
    ref: -1, state: 'n', due: '0', scheduled_days: 0, last_review: '0', stability: 0,
    difficulty: 0, learning_steps: 0, reps: 0, lapses: 0, ordinal: 1
  }])
  assert.equal(serialize(parsed, note.cards), `
Q:: answer[:1]

<!-- CARDS
[7:k:20261014040000:7:20261007120000:8.5:4.2:0:10:1]
-->
`.slice(1))
}

/** Every offered choice maps to its rating; any other identifier, such as a malformed message's, is rejected. */
export function test_choices_map_to_ratings_and_unknown_identifiers_are_rejected() {
  assert.equal(review_rating('again'), 1)
  assert.equal(review_rating('hard'), 2)
  assert.equal(review_rating('good'), 3)
  assert.equal(review_rating('easy'), 4)
  assert.equal(review_rating('tomorrow'), 'tomorrow')
  assert.equal(review_rating('soon'), 'soon')
  assert.equal(review_rating('later'), 'later')
  assert.equal(review_rating('Good'), null)
  assert.equal(review_rating(''), null)
}

/**
 * The problems of the parse and of the cards reach the note, which keeps its parsed text as its version, and the
 * review's notices, below a heading, in either language; definitions are quoted as written.
 */
export function test_problems_reach_the_note_and_the_review_notices(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00:00+02:00') })
  const source = `
A:: first[:1]

B:: second[:2]

[:1]: k 20261034040000 7 20261007120000 8.5 4.2 0 10 1
[:2]: k 20261014040000 7 20261007120000 8.5 4.2 0 10 1
[:2]: l 0 0 0 0 0 0 0 0
[:5]: k 20261014040000 7 20261007120000 8.5 4.2 0 10 1
`.slice(1)
  const scheduler = make_scheduler()
  const parsed = parse(source)
  const { note } = note_from_parse(scheduler, 'note.sr.md', parsed)
  scheduler.update([], [note])
  assert.equal(note.version, source)
  assert.deepEqual(note.problems, [
    { kind: 'duplicate_definition', ref: 2, line: 7 },
    { kind: 'unmatched_definition', ref: 5, line: 8 },
    { kind: 'invalid_date', ordinal: 1, field: 'due', value: '20261034040000' }
  ])
  assert.deepEqual(prepare_review(scheduler, note.path, 2, parsed).notices, [
    'This note has problems. Saving a review can lose information, so check the note first.',
    'Line 7: definition [:2] repeats an earlier one; saving a review removes it.',
    'Line 8: definition [:5] belongs to no cloze; saving a review removes it.',
    'Card 1 has an invalid due date, 20261034040000; it is not reviewed until the date is fixed.'
  ])
  set_language('sv')
  t.after(() => set_language('en'))
  assert.deepEqual(prepare_review(scheduler, note.path, 2, parsed).notices, [
    'Anteckningen har problem. En sparad repetition kan förlora information, så kontrollera anteckningen först.',
    'Rad 7: definitionen [:2] upprepar en tidigare; en sparad repetition tar bort den.',
    'Rad 8: definitionen [:5] hör inte till någon lucka; en sparad repetition tar bort den.',
    'Kort 1 har ett ogiltigt datum för förfallodag, 20261034040000; det repeteras inte förrän datumet rättats.'
  ])
}

// Run every test_ function above as a test named after it.
for (const [name, fn] of Object.entries(tests)) if (name.startsWith('test_')) test(name, fn)
