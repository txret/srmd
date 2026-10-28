// Manual scheduling hints (SYNTAX.md, "Manual scheduling"): the scheduler resolves them in its own copy of the cards,
// setting the state and due date only; the parse keeps the hints.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MAX_HINT_DAYS, Scheduler, add_review_days, serialize_date } from '../src/index.ts'
import { parse, persist_hints, serialize } from '../../parser/src/index.ts'
import * as tests from './hints.test.mjs'

/** Known cards due at these local times, which make their days busy for load balancing. */
function due_on(times) {
  return times.map((time, index) => ({
    ref: index + 1, state: 'k', due: serialize_date(new Date(time)), last_review: '0',
    scheduled_days: 0, stability: 0, difficulty: 0, learning_steps: 0, reps: 1, lapses: 0
  }))
}

/**
 * Duration hints set state `k` and a due date at the rollover, here 04:30, that many review days ahead: 7d seven, 2w
 * fourteen, 1m thirty, across the autumn clock change. The other fields stay, the parse keeps the hints, and the
 * saved note holds no hint to resolve again.
 */
export function test_duration_hints_set_the_due_date_that_many_days_ahead() {
  const scheduler = new Scheduler()
  scheduler.state.config.rollover = 16200000
  const source = `
A:: a[:1]

B:: b[:2]

C:: c[:3]

[:1]: 7d 20000101040000 99 20000101040000 0 0 5 0 0
[:2]: 2w 20000101040000 99 20000101040000 0 0 5 0 0
[:3]: 1m 20000101040000 99 20000101040000 0 0 5 0 0
`.slice(1)
  const parsed = parse(source)
  const original = structuredClone(parsed.scheduling)
  const { note, scheduling_changed } = scheduler.create_note('note.sr.md', parsed.scheduling, new Date('2026-10-10T12:00:00+02:00'), () => 0)
  assert.equal(scheduling_changed, true)
  const saved = persist_hints(parsed.source, parsed.hints, note.cards)
  assert.equal(saved, `
A:: a[:1]

B:: b[:2]

C:: c[:3]

[:1]: k 20261017043000 99 20000101040000 0 0 5 0 0
[:2]: k 20261024043000 99 20000101040000 0 0 5 0 0
[:3]: k 20261109043000 99 20000101040000 0 0 5 0 0
`.slice(1))
  assert.equal(parsed.source, source)
  assert.deepEqual(parsed.scheduling, original)

  const reloaded = parse(saved)
  assert.equal(scheduler.create_note('note.sr.md', reloaded.scheduling).scheduling_changed, false)
  assert.equal(serialize(reloaded, reloaded.scheduling), saved)
}

/** A hint records no review, so FSRS previews the card's first review: the same intervals whatever the hint. */
export function test_a_hinted_card_previews_a_first_review(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-24T12:00:00+02:00') })
  const scheduler = new Scheduler()
  scheduler.load('/workspace')
  const parsed = parse('Q:: answer[:1]\n\n[:1]: 7d 20000101040000 99 20000101040000 0 0 5 0 0\n')
  scheduler.update([], [scheduler.create_note('note.sr.md', parsed.scheduling).note])
  assert.deepEqual(scheduler.peek('note.sr.md', 1), {
    again: { unit: 'days', count: 1 }, hard: { unit: 'days', count: 1 },
    good: { unit: 'days', count: 2 }, easy: { unit: 'days', count: 8 }
  })
}

/**
 * A `!` hint takes the least loaded day 7–21 days ahead, choosing randomly among equal ones, once: day 7 when all are
 * free and the random choice is the first, day 8 when day 7 is busy, day 21 when days 7–20 are.
 */
export function test_a_bang_hint_takes_the_least_loaded_day_7_to_21_days_ahead(t) {
  // All free, rollover 04:30.
  const free = new Scheduler()
  free.state.config.rollover = 16200000
  const all_free = parse('Q:: answer[:1]\n\n[:1]: ! 0 0 0 0 0 3 0 0\n')
  const free_note = free.create_note('note.sr.md', all_free.scheduling, new Date('2026-10-10T12:00:00+02:00'), () => 0).note
  assert.equal(persist_hints(all_free.source, all_free.hints, free_note.cards), 'Q:: answer[:1]\n\n[:1]: k 20261017043000 0 0 0 0 3 0 0\n')

  // Day 7 busy, rollover 04:00; the other fields stay.
  const day_7 = new Scheduler()
  day_7.load('/workspace')
  day_7.update([], [day_7.create_note('busy.sr.md', due_on(['2026-10-17T04:00:00+02:00'])).note])
  const day_7_busy = parse('Q:: answer[:7]\n\n[:7]: ! 0 0 0 12.5 5.1 3 10 2\n')
  let random_calls = 0
  const random = () => {
    random_calls++
    return 0
  }
  const day_7_note = day_7.create_note('note.sr.md', day_7_busy.scheduling, new Date('2026-10-10T12:00:00+02:00'), random).note
  assert.deepEqual(day_7_note.cards, [{
    ref: 7, state: 'k', due: '20261018040000', scheduled_days: 0, last_review: '0',
    stability: 12.5, difficulty: 5.1, learning_steps: 3, reps: 10, lapses: 2, ordinal: 1
  }])
  assert.equal(persist_hints(day_7_busy.source, day_7_busy.hints, day_7_note.cards), 'Q:: answer[:7]\n\n[:7]: k 20261018040000 0 0 12.5 5.1 3 10 2\n')
  assert.equal(random_calls, 1)

  // Days 7 to 20 busy, at 2026-09-24 12:00.
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-24T12:00:00+02:00') })
  const crowded = new Scheduler()
  crowded.load('/workspace')
  crowded.update([], [crowded.create_note('busy.sr.md', due_on([
    '2026-10-01T04:00:00+02:00', '2026-10-02T04:00:00+02:00', '2026-10-03T04:00:00+02:00', '2026-10-04T04:00:00+02:00',
    '2026-10-05T04:00:00+02:00', '2026-10-06T04:00:00+02:00', '2026-10-07T04:00:00+02:00', '2026-10-08T04:00:00+02:00',
    '2026-10-09T04:00:00+02:00', '2026-10-10T04:00:00+02:00', '2026-10-11T04:00:00+02:00', '2026-10-12T04:00:00+02:00',
    '2026-10-13T04:00:00+02:00', '2026-10-14T04:00:00+02:00'
  ])).note])
  const days_7_to_20_busy = parse('Q:: answer[:1]\n\n[:1]: ! 0 0 0 0 0 0 0 0\n')
  const crowded_note = crowded.create_note('note.sr.md', days_7_to_20_busy.scheduling).note
  assert.equal(persist_hints(days_7_to_20_busy.source, days_7_to_20_busy.hints, crowded_note.cards), 'Q:: answer[:1]\n\n[:1]: k 20261015040000 0 0 0 0 0 0 0\n')
}

/** Hints resolve in card order, so a `!` hint counts the days earlier hints of the same note took: two pick different days. */
export function test_hints_in_one_note_see_the_days_of_earlier_hints() {
  const scheduler = new Scheduler()
  const parsed = parse(`
Fixed:: first[:1]

Random:: second[:2]

Random:: third[:3]

[:1]: 7d 0 0 0 0 0 0 0 0
[:2]: ! 0 0 0 0 0 0 0 0
[:3]: ! 0 0 0 0 0 0 0 0
`.slice(1))
  const { note } = scheduler.create_note('note.sr.md', parsed.scheduling, new Date('2026-10-10T12:00:00+02:00'), () => 0)
  assert.deepEqual(note.cards, [
    {
      ref: 1, state: 'k', due: '20261017040000', scheduled_days: 0, last_review: '0', stability: 0,
      difficulty: 0, learning_steps: 0, reps: 0, lapses: 0, ordinal: 1
    },
    {
      ref: 2, state: 'k', due: '20261018040000', scheduled_days: 0, last_review: '0', stability: 0,
      difficulty: 0, learning_steps: 0, reps: 0, lapses: 0, ordinal: 2
    },
    {
      ref: 3, state: 'k', due: '20261019040000', scheduled_days: 0, last_review: '0', stability: 0,
      difficulty: 0, learning_steps: 0, reps: 0, lapses: 0, ordinal: 3
    }
  ])
  // The parse keeps the hints.
  assert.deepEqual(parsed.scheduling, [
    {
      ref: 1, state: '7d', due: '0', scheduled_days: 0, last_review: '0',
      stability: 0, difficulty: 0, learning_steps: 0, reps: 0, lapses: 0
    },
    {
      ref: 2, state: '!', due: '0', scheduled_days: 0, last_review: '0',
      stability: 0, difficulty: 0, learning_steps: 0, reps: 0, lapses: 0
    },
    {
      ref: 3, state: '!', due: '0', scheduled_days: 0, last_review: '0',
      stability: 0, difficulty: 0, learning_steps: 0, reps: 0, lapses: 0
    }
  ])
}

/**
 * A `!` hint balances against the other loaded notes, not the old version of its own note: the old card's day is
 * free. Only `!` hints look at other notes at all.
 */
export function test_bang_hints_balance_against_other_notes_only(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00:00+02:00') })
  const scheduler = new Scheduler()
  scheduler.load('/workspace')
  scheduler.update([], [scheduler.create_note('note.sr.md', parse('Q:: answer[:8]\n\n[:8]: k 20261022040000 7 20261015120000 7 5 0 1 0').scheduling).note])
  const parsed = parse('Q:: answer[:8]\n\n[:8]: ! 0 0 0 0 0 0 0 0')
  const { note, scheduling_changed } = scheduler.create_note('note.sr.md', parsed.scheduling, new Date(), () => 0)
  assert.equal(scheduling_changed, true)
  assert.deepEqual(note.cards, [{
    ref: 8, state: 'k', due: '20261022040000', scheduled_days: 0, last_review: '0', stability: 0,
    difficulty: 0, learning_steps: 0, reps: 0, lapses: 0, ordinal: 1
  }])
  assert.deepEqual(parsed.scheduling, [{
    ref: 8, state: '!', due: '0', scheduled_days: 0, last_review: '0',
    stability: 0, difficulty: 0, learning_steps: 0, reps: 0, lapses: 0
  }])

  // Reading the other notes now fails the test: a new card and a duration hint must not need them.
  Object.defineProperty(scheduler.state, 'nodes', { get: () => assert.fail('ordinary loads must not inspect other notes') })
  assert.deepEqual(scheduler.create_note('fresh.sr.md', parse('Q:: new').scheduling).note.cards, [{
    ref: -1, state: 'n', due: '0', scheduled_days: 0, last_review: '0', stability: 0,
    difficulty: 0, learning_steps: 0, reps: 0, lapses: 0, ordinal: 1
  }])
  assert.deepEqual(scheduler.create_note('duration.sr.md', parse('Q:: answer[:1]\n\n[:1]: 7d 0 0 0 0 0 0 0 0').scheduling).note.cards, [{
    ref: 1, state: 'k', due: '20261022040000', scheduled_days: 0, last_review: '0', stability: 0,
    difficulty: 0, learning_steps: 0, reps: 0, lapses: 0, ordinal: 1
  }])
}

/** A hint beyond the supported range is capped at about a century, so the due date stays a valid date. */
export function test_a_hint_beyond_the_supported_range_is_capped(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00:00+02:00') })
  const scheduler = new Scheduler()
  scheduler.load('/workspace')
  const parsed = parse('Q:: a[:1]\n\n[:1]: 999999999999d 0 0 0 0 0 0 0 0\n')
  const { note, scheduling_changed } = scheduler.create_note('note.sr.md', parsed.scheduling)
  assert.equal(scheduling_changed, true)
  assert.equal(note.cards[0].due, serialize_date(add_review_days(new Date(), MAX_HINT_DAYS, 4 * 3600000)))
  assert.equal(parse(persist_hints(parsed.source, parsed.hints, note.cards)).scheduling[0].state, 'k')
  // An unbounded interval would make an invalid date, which cannot be written.
  assert.throws(() => serialize_date(new Date(NaN)), RangeError)
}

// Run every test_ function above as a test named after it.
for (const [name, fn] of Object.entries(tests)) if (name.startsWith('test_')) test(name, fn)
