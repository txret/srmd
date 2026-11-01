// review_scopes(): the notes and folders holding cards, offered for choosing what to review.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Scheduler } from '../../scheduler/src/index.ts'
import { parse } from '../../parser/src/index.ts'
import { note_from_parse, review_scopes } from '../src/index.ts'
import * as tests from './scopes.test.mjs'

/**
 * A workspace of four notes: a.sr.md has a new and a due card, plain.sr.md no cards, c.sr.md a new card and an
 * orphaned definition, which is a problem, and apart.sr.md a new card.
 */
function make_state() {
  const scheduler = new Scheduler()
  scheduler.load('/workspace')
  for (const [path, source] of Object.entries({
    'topic/a.sr.md': 'New:: first\n\nDue:: second[:1]\n\n[:1]: k 20261014040000 7 20261007120000 8.5 4.2 0 10 1\n',
    'topic/plain.sr.md': 'No clozes',
    'other/deep/c.sr.md': 'Q:: third\n\n[:9]: k 0\n',
    'apart.sr.md': 'Q:: fourth'
  })) scheduler.update([], [note_from_parse(scheduler, path, parse(source)).note])
  scheduler.state.recount(new Date('2026-10-15T12:00:00+02:00').getTime())
  return scheduler.state
}

/**
 * Every note and folder holding cards is offered in display order with its counts, the open folder first; a note
 * without cards is left out, and problems show on the note and its folders.
 */
export function test_every_scope_with_cards_is_offered_in_display_order() {
  assert.deepEqual(review_scopes(make_state()), [
    { path: '', folder: true, counts: { due: 1, new: 3, later: 0 }, problems: true },
    { path: 'other', folder: true, counts: { due: 0, new: 1, later: 0 }, problems: true },
    { path: 'other/deep', folder: true, counts: { due: 0, new: 1, later: 0 }, problems: true },
    { path: 'other/deep/c.sr.md', folder: false, counts: { due: 0, new: 1, later: 0 }, problems: true },
    { path: 'topic', folder: true, counts: { due: 1, new: 1, later: 0 }, problems: false },
    { path: 'topic/a.sr.md', folder: false, counts: { due: 1, new: 1, later: 0 }, problems: false },
    { path: 'apart.sr.md', folder: false, counts: { due: 0, new: 1, later: 0 }, problems: false }
  ])
}

// Run every test_ function above as a test named after it.
for (const [name, fn] of Object.entries(tests)) if (name.startsWith('test_')) test(name, fn)
