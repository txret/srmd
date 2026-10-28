// Queues, counts and reviews (ARCHITECTURE.md, "Queues and review days"); the rollover is 04:00.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Scheduler, get_counts, serialize_date } from '../src/index.ts'
import { parse, serialize } from '../../parser/src/index.ts'
import * as tests from './queues.test.mjs'

/** A scheduler with an empty workspace; each test inserts its own notes. */
function make_scheduler() {
  const scheduler = new Scheduler()
  scheduler.load('/workspace')
  return scheduler
}

/** Known cards due at these local times, which make their days busy for load balancing. */
function due_on(times) {
  return times.map((time, index) => ({
    ref: index + 1, state: 'k', due: serialize_date(new Date(time)), last_review: '0',
    scheduled_days: 0, stability: 0, difficulty: 0, learning_steps: 0, reps: 1, lapses: 0
  }))
}

/**
 * Review the card of `Q:: answer` with a fixed-interval choice at 2026-09-24 12:00, in a workspace with another note
 * whose cards are due at the busy times, and return the saved note.
 */
function save_choice(choice, busy_times) {
  const scheduler = make_scheduler()
  const parsed = parse('Q:: answer')
  const { note } = scheduler.create_note('note.sr.md', parsed.scheduling)
  scheduler.update([], [note, scheduler.create_note('busy.sr.md', due_on(busy_times)).note])
  scheduler.review('note.sr.md', 1, choice)
  return serialize(parsed, note.cards)
}

/**
 * A recount on the same review day keeps the queues; on the next one it rebuilds them, and interday cards are served
 * in card order, whatever their due times that day.
 */
export function test_a_recount_rebuilds_queues_only_on_a_new_review_day(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-24T12:00:00+02:00') })
  const scheduler = make_scheduler()
  const { state } = scheduler
  const { note } = scheduler.create_note('note.sr.md', parse(`
A:: first[:1]

B:: second[:2]

[:1]: k 20260925170000 1 20260924120000 10 5 0 1 0
[:2]: k 20260925100000 1 20260924120000 10 5 0 1 0
`.slice(1)).scheduling)
  scheduler.update([], [note])

  state.recount(new Date('2026-09-24T12:00:00+02:00').getTime())
  assert.deepEqual(note.interday, [])
  const queue = note.interday
  state.recount(new Date('2026-09-24T13:00:00+02:00').getTime())
  assert.equal(note.interday, queue)

  assert.deepEqual(scheduler.next_card('', new Date('2026-09-25T04:00:00+02:00').getTime()), ['note.sr.md', 1])
  assert.deepEqual(note.interday, [
    {
      ref: 1, state: 'k', due: '20260925170000', scheduled_days: 1, last_review: '20260924120000', stability: 10,
      difficulty: 5, learning_steps: 0, reps: 1, lapses: 0, ordinal: 1
    },
    {
      ref: 2, state: 'k', due: '20260925100000', scheduled_days: 1, last_review: '20260924120000', stability: 10,
      difficulty: 5, learning_steps: 0, reps: 1, lapses: 0, ordinal: 2
    }
  ])
  assert.equal(state.nodes[''].interday, 2)
}

/** An intraday card becomes due at its exact due time; the recount counts it without rebuilding the queue. */
export function test_an_intraday_card_becomes_due_at_its_exact_time(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-24T12:00:00+02:00') })
  const scheduler = make_scheduler()
  const { state } = scheduler
  const { note } = scheduler.create_note('note.sr.md', parse(`
Q:: answer[:1]

[:1]: k 20260924120100 0 20260924120000 10 5 0 1 0
`.slice(1)).scheduling)
  scheduler.update([], [note])

  state.recount(new Date('2026-09-24T12:00:00+02:00').getTime())
  assert.deepEqual([note.intraday_due, state.nodes[''].intraday_due], [0, 0])
  assert.deepEqual(note.intraday, [{
    ref: 1, state: 'k', due: '20260924120100', scheduled_days: 0, last_review: '20260924120000', stability: 10,
    difficulty: 5, learning_steps: 0, reps: 1, lapses: 0, ordinal: 1
  }])
  const queue = note.intraday

  state.recount(new Date('2026-09-24T12:02:00+02:00').getTime())
  assert.deepEqual([note.intraday_due, state.nodes[''].intraday_due], [1, 1])
  assert.equal(note.intraday, queue)
}

/**
 * Counts split every card into due, new and later, for notes and every folder above them: a learning card is later
 * until its exact due time on the same review day.
 */
export function test_counts_split_cards_into_due_new_and_later(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00:00+02:00') })
  const scheduler = make_scheduler()
  const { state } = scheduler
  const mixed = `
Overdue:: first[:1]

Fresh:: second

Learning:: third[:2]

Tomorrow:: fourth[:3]

[:1]: k 20261014040000 7 20261007120000 8.5 4.2 0 10 1
[:2]: l 20261015121000 0 20261015120000 2.3065 2.11810397 1 1 0
[:3]: k 20261016040000 1 20261015110000 8.5 4.2 0 10 1
`.slice(1)
  scheduler.update([], [
    scheduler.create_note('topic/deep/mixed.sr.md', parse(mixed).scheduling).note,
    scheduler.create_note('topic/fresh.sr.md', parse('Q:: new').scheduling).note,
    scheduler.create_note('empty.sr.md', parse('No cards').scheduling).note
  ])
  state.recount()
  assert.deepEqual(get_counts(state.nodes['topic/deep/mixed.sr.md']), { due: 1, new: 1, later: 2 })
  assert.deepEqual(get_counts(state.nodes['topic/deep']), { due: 1, new: 1, later: 2 })
  assert.deepEqual(get_counts(state.nodes['topic/fresh.sr.md']), { due: 0, new: 1, later: 0 })
  assert.deepEqual(get_counts(state.nodes.topic), { due: 1, new: 2, later: 2 })
  assert.deepEqual(get_counts(state.nodes['empty.sr.md']), { due: 0, new: 0, later: 0 })
  assert.deepEqual(get_counts(state.nodes['']), { due: 1, new: 2, later: 2 })

  state.recount(new Date('2026-10-15T12:10:00+02:00').getTime())
  assert.deepEqual(get_counts(state.nodes['topic/deep/mixed.sr.md']), { due: 2, new: 1, later: 1 })
  assert.deepEqual(get_counts(state.nodes['']), { due: 2, new: 2, later: 1 })
}

/**
 * Fixed-interval choices are reviews: Tomorrow is one day ahead; Soon and Later take the least loaded day of 3–5 and
 * 7–21 days ahead, here the last ones, since the others are busy.
 */
export function test_fixed_interval_choices(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-24T12:00:00+02:00') })
  assert.equal(save_choice('tomorrow', []), `
Q:: answer[:1]

[:1]: k 20260925040000 1 20260924120000 2.3065 2.11810397 0 1 0
`.slice(1))

  assert.equal(save_choice('soon', ['2026-09-27T04:00:00+02:00', '2026-09-28T04:00:00+02:00']), `
Q:: answer[:1]

[:1]: k 20260929040000 5 20260924120000 5 2.11810397 0 1 0
`.slice(1))

  assert.equal(save_choice('later', [
    '2026-10-01T04:00:00+02:00', '2026-10-02T04:00:00+02:00', '2026-10-03T04:00:00+02:00', '2026-10-04T04:00:00+02:00',
    '2026-10-05T04:00:00+02:00', '2026-10-06T04:00:00+02:00', '2026-10-07T04:00:00+02:00', '2026-10-08T04:00:00+02:00',
    '2026-10-09T04:00:00+02:00', '2026-10-10T04:00:00+02:00', '2026-10-11T04:00:00+02:00', '2026-10-12T04:00:00+02:00',
    '2026-10-13T04:00:00+02:00', '2026-10-14T04:00:00+02:00'
  ]), `
Q:: answer[:1]

[:1]: k 20261015040000 21 20260924120000 21 2.11810397 0 1 0
`.slice(1))
}

/** rated() computes the rated card without changing state; only apply(), after the host saved, commits it. */
export function test_rated_leaves_state_unchanged_until_apply_commits(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00:00+02:00') })
  const scheduler = make_scheduler()
  const { note } = scheduler.create_note('note.sr.md', parse('Q:: a[:1]\n\n[:1]: k 20261001120000 1 20260930120000 10 5 0 1 0\n').scheduling)
  scheduler.update([], [note])
  const before = { ...note.cards[0] }
  const card = scheduler.rated('note.sr.md', 1, 'tomorrow')
  assert.deepEqual(card, { ...before, due: '20261016040000', scheduled_days: 1, last_review: '20261015120000', reps: 2 })
  assert.deepEqual(note.cards[0], before)
  assert.deepEqual(scheduler.next_card(''), ['note.sr.md', 1])

  scheduler.apply('note.sr.md', card)
  assert.equal(note.cards[0], card)
  assert.deepEqual(scheduler.next_card(''), [null, null])
}

/**
 * A card with a date outside the calendar is a problem of its note, kept as written, counted as later and never
 * served; the note's other cards are reviewed and saved as usual. Folders count notes with problems.
 */
export function test_a_card_with_an_invalid_date_is_never_served(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00:00+02:00') })
  const scheduler = make_scheduler()
  const { state } = scheduler
  const parsed = parse(`
A:: first[:1]

B:: second[:2]

C:: third[:3]

[:1]: k 20260834120000 1 20260801120000 10 5 0 1 0
[:2]: k 20261001120000 1 20260930250000 10 5 0 1 0
[:3]: k 20261001120000 1 20260930120000 10 5 0 1 0
`.slice(1))
  const { note } = scheduler.create_note('topic/note.sr.md', parsed.scheduling)
  scheduler.update([], [note])
  assert.deepEqual(note.problems, [
    { kind: 'invalid_date', ordinal: 1, field: 'due', value: '20260834120000' },
    { kind: 'invalid_date', ordinal: 2, field: 'last_review', value: '20260930250000' }
  ])
  assert.deepEqual(note.interday.map(card => card.ordinal), [3])
  state.recount()
  assert.deepEqual(get_counts(note), { due: 1, new: 0, later: 2 })
  assert.deepEqual([state.nodes.topic.problems, state.nodes[''].problems], [1, 1])

  assert.deepEqual(scheduler.next_card(''), ['topic/note.sr.md', 3])
  scheduler.review('topic/note.sr.md', 3, 'tomorrow')
  assert.deepEqual(scheduler.next_card(''), [null, null])
  assert.equal(serialize(parsed, note.cards), `
A:: first[:1]

B:: second[:2]

C:: third[:3]

[:1]: k 20260834120000 1 20260801120000 10 5 0 1 0
[:2]: k 20261001120000 1 20260930250000 10 5 0 1 0
[:3]: k 20261016040000 1 20261015120000 10 5 0 2 0
`.slice(1))

  scheduler.update(['topic/note.sr.md'], [])
  state.recount()
  assert.equal(state.nodes[''].problems, 0)
}

/** An opener whose answer never comes, here at the end of a quote, makes no card: the note's one card is the next. */
export function test_an_opener_without_an_answer_makes_no_card(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-24T12:00:00+02:00') })
  const scheduler = make_scheduler()
  const parsed = parse(`
> A::

B:: beta`.slice(1))
  const { note } = scheduler.create_note('note.sr.md', parsed.scheduling)
  scheduler.update([], [note])
  assert.deepEqual(note.cards, [{
    ref: -1, state: 'n', due: '0', scheduled_days: 0, last_review: '0', stability: 0,
    difficulty: 0, learning_steps: 0, reps: 0, lapses: 0, ordinal: 1
  }])
  assert.deepEqual(scheduler.next_card('note.sr.md'), ['note.sr.md', 1])
  scheduler.review('note.sr.md', 1, 'tomorrow')
  assert.equal(serialize(parsed, note.cards), `
> A::

B:: beta[:1]

[:1]: k 20260925040000 1 20260924120000 2.3065 2.11810397 0 1 0
`.slice(1))
}

// Run every test_ function above as a test named after it.
for (const [name, fn] of Object.entries(tests)) if (name.startsWith('test_')) test(name, fn)
