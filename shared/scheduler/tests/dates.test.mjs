// Review days and timestamps (ARCHITECTURE.md, "Queues and review days"); the rollover is 04:00 unless stated.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { add_review_days, day_diff, is_valid_date, parse_date, serialize_date } from '../src/index.ts'
import * as tests from './dates.test.mjs'

const rollover = 4 * 3600000

/** A review day starts at the rollover: 03:59 is still the previous day, 04:00 and 05:00 the day of 17:00. */
export function test_a_review_day_starts_at_the_rollover() {
  const due = new Date('2026-09-25T17:00:00+02:00')
  assert.equal(day_diff(due, new Date('2026-09-25T03:59:00+02:00'), rollover), 1)
  assert.equal(day_diff(due, new Date('2026-09-25T04:00:00+02:00'), rollover), 0)
  assert.equal(day_diff(due, new Date('2026-09-25T05:00:00+02:00'), rollover), 0)
}

/**
 * One review day ahead is the next rollover: 23 hours away across the spring clock change, 25 across the autumn one,
 * and later on the same date when it is still before the rollover.
 */
export function test_one_review_day_ahead_is_the_next_rollover() {
  const spring = new Date('2026-03-28T04:00:00+01:00')
  assert.deepEqual(add_review_days(spring, 1, rollover), new Date('2026-03-29T04:00:00+02:00'))
  assert.equal(day_diff(new Date('2026-03-29T04:00:00+02:00'), spring, rollover), 1)

  const autumn = new Date('2026-10-24T04:00:00+02:00')
  assert.deepEqual(add_review_days(autumn, 1, rollover), new Date('2026-10-25T04:00:00+01:00'))
  assert.equal(day_diff(new Date('2026-10-25T04:00:00+01:00'), autumn, rollover), 1)

  const before_rollover = new Date('2026-09-25T02:00:00+02:00')
  assert.deepEqual(add_review_days(before_rollover, 1, rollover), new Date('2026-09-25T04:00:00+02:00'))
  assert.equal(day_diff(new Date('2026-09-25T04:00:00+02:00'), before_rollover, rollover), 1)
}

/** A timestamp is `0`, unset, or fourteen digits of a date and time that exist in the calendar. */
export function test_timestamps_are_unset_or_calendar_dates() {
  assert.equal(is_valid_date('0'), true)
  assert.equal(is_valid_date('20260831235959'), true)
  assert.equal(is_valid_date('20240229000000'), true)
  assert.equal(is_valid_date('00010101000000'), true)

  assert.equal(is_valid_date('20260834120000'), false, '34 August')
  assert.equal(is_valid_date('20230229000000'), false, '29 February outside a leap year')
  assert.equal(is_valid_date('20260431000000'), false, '31 April')
  assert.equal(is_valid_date('00000101000000'), false, 'year 0')
  assert.equal(is_valid_date('20261301000000'), false, 'month 13')
  assert.equal(is_valid_date('20260001000000'), false, 'month 0')
  assert.equal(is_valid_date('20260100000000'), false, 'day 0')
  assert.equal(is_valid_date('20260101240000'), false, 'hour 24')
  assert.equal(is_valid_date('20260101006000'), false, 'minute 60')
  assert.equal(is_valid_date('20260101000060'), false, 'second 60')
  assert.equal(is_valid_date('2026010100000'), false, 'thirteen digits')
}

/** Timestamps before year 100 decode to the year as written, which the Date constructor would map to 1900–1999. */
export function test_timestamps_before_year_100_keep_their_year() {
  const date = parse_date('00500102030405')
  assert.deepEqual([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds()], [50, 0, 2, 3, 4, 5])
  assert.equal(serialize_date(date), '00500102030405')
}

// Run every test_ function above as a test named after it.
for (const [name, fn] of Object.entries(tests)) if (name.startsWith('test_')) test(name, fn)
