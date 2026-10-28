// review_scopes(): the notes and folders holding cards, offered for choosing what to review, with fuzzy search.
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

/** The paths review_scopes() offers for a query, in its order. */
function paths(query) {
  return review_scopes(make_state(), query, 'workspace').map(scope => scope.path)
}

/**
 * Without a query, a blank one included, every note and folder holding cards is offered in display order with its
 * counts, the open folder first; a note without cards is left out, and problems show on the note and its folders.
 */
export function test_without_a_query_every_scope_with_cards_is_offered_in_display_order() {
  assert.deepEqual(review_scopes(make_state(), '  ', 'workspace'), [
    { path: '', folder: true, counts: { due: 1, new: 3, later: 0 }, problems: true },
    { path: 'other', folder: true, counts: { due: 0, new: 1, later: 0 }, problems: true },
    { path: 'other/deep', folder: true, counts: { due: 0, new: 1, later: 0 }, problems: true },
    { path: 'other/deep/c.sr.md', folder: false, counts: { due: 0, new: 1, later: 0 }, problems: true },
    { path: 'topic', folder: true, counts: { due: 1, new: 1, later: 0 }, problems: false },
    { path: 'topic/a.sr.md', folder: false, counts: { due: 1, new: 1, later: 0 }, problems: false },
    { path: 'apart.sr.md', folder: false, counts: { due: 0, new: 1, later: 0 }, problems: false }
  ])
}

/**
 * A query matches a path containing each of its terms as characters in order, ignoring case; the open folder
 * matches by its name. Matches rank by characters starting words, then shorter paths.
 */
export function test_a_query_matches_its_terms_as_characters_in_order() {
  assert.deepEqual(paths('DEEP'), ['other/deep', 'other/deep/c.sr.md'])
  // Across words and folders.
  assert.deepEqual(paths('tpa'), ['topic/a.sr.md'])
  // Every term must match, in any order.
  assert.deepEqual(paths('sr deep'), ['other/deep/c.sr.md'])
  assert.deepEqual(paths('worksp'), [''])
  assert.deepEqual(paths('ct'), [])
  // `o` and `c` start words only in other/deep/c.sr.md; the other matches tie and come shortest first.
  assert.deepEqual(paths('oc'), ['other/deep/c.sr.md', 'topic', '', 'topic/a.sr.md'])
  assert.deepEqual(paths('sr'), ['apart.sr.md', 'topic/a.sr.md', 'other/deep/c.sr.md'])
}

// Run every test_ function above as a test named after it.
for (const [name, fn] of Object.entries(tests)) if (name.startsWith('test_')) test(name, fn)
