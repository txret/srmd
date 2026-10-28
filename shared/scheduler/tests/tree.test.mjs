// The note and folder tree (ARCHITECTURE.md, "Scheduler"): insertion, removal, display order and folder totals.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FOLDER, NOTE, Scheduler, get_counts } from '../src/index.ts'
import { parse } from '../../parser/src/index.ts'
import * as tests from './tree.test.mjs'

/** A scheduler with an empty workspace; each test inserts its own notes. */
function make_scheduler() {
  const scheduler = new Scheduler()
  scheduler.load('/workspace')
  return scheduler
}

/** Removing paths that hold nothing changes nothing; removing a folder's last note removes the folder. */
export function test_removing_notes_prunes_empty_folders_only() {
  const scheduler = make_scheduler()
  const { state } = scheduler
  scheduler.update([], [
    scheduler.create_note('folder/one.sr.md', parse('Q:: one').scheduling).note,
    scheduler.create_note('folder/two.sr.md', parse('Q:: two').scheduling).note
  ])

  // A folder that still holds notes is not removed either.
  scheduler.update(['ghost.sr.md', 'folder/ghost.sr.md', 'folder'], [])
  assert.deepEqual(Object.keys(state.nodes).sort(), ['', 'folder', 'folder/one.sr.md', 'folder/two.sr.md'])
  assert.deepEqual(state.nodes.folder.children, ['folder/one.sr.md', 'folder/two.sr.md'])

  scheduler.update(['folder/one.sr.md'], [])
  assert.deepEqual(Object.keys(state.nodes).sort(), ['', 'folder', 'folder/two.sr.md'])
  assert.deepEqual(state.nodes.folder.children, ['folder/two.sr.md'])

  scheduler.update(['folder/two.sr.md'], [])
  assert.deepEqual(Object.keys(state.nodes), [''])
  assert.deepEqual(state.nodes[''].children, [])
}

/**
 * Folder totals count every card below them, also cards due on later days, and lose them when a note is replaced by
 * one without cards or removed.
 */
export function test_folder_totals_follow_their_notes(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00:00+02:00') })
  const scheduler = make_scheduler()
  const { state } = scheduler
  const later = `
Q:: later[:1]

[:1]: k 20261016040000 1 20261015120000 8.5 4.2 0 10 1
`.slice(1)
  scheduler.update([], [
    scheduler.create_note('topic/deep/later.sr.md', parse(later).scheduling).note,
    scheduler.create_note('topic/empty.sr.md', parse('No cards').scheduling).note
  ])
  state.recount()
  for (const path of ['', 'topic', 'topic/deep']) {
    const { total, interday, intraday_due, new: fresh } = state.nodes[path]
    assert.deepEqual({ total, interday, intraday_due, fresh }, { total: 1, interday: 0, intraday_due: 0, fresh: 0 }, path)
  }

  scheduler.update([], [scheduler.create_note('topic/deep/later.sr.md', parse('No cards now').scheduling).note])
  state.recount()
  assert.deepEqual([state.nodes[''].total, state.nodes.topic.total, state.nodes['topic/deep'].total], [0, 0, 0])

  scheduler.update([], [scheduler.create_note('topic/deep/later.sr.md', parse(later).scheduling).note])
  state.recount()
  assert.equal(state.nodes[''].total, 1)
  scheduler.update(['topic/deep/later.sr.md'], [])
  state.recount()
  assert.equal(state.nodes['topic/deep'], undefined)
  assert.deepEqual([state.nodes[''].total, state.nodes.topic.total], [0, 0])
}

/**
 * Folders list their children in display order whatever the insertion order: folders first, then names ignoring
 * case, with numbers compared as numbers. A replaced note keeps its place, and reviews serve notes depth-first in
 * that order.
 */
export function test_folders_keep_children_in_display_order_and_reviews_follow_it() {
  const scheduler = make_scheduler()
  const { state } = scheduler
  for (const path of ['f/b.sr.md', 'f/Note 10.sr.md', 'f/a.sr.md', 'f/deep/z.sr.md', 'f/note 9.sr.md', 'f/Alpha/y.sr.md']) {
    scheduler.update([], [scheduler.create_note(path, parse('Q:: x').scheduling).note])
  }
  assert.deepEqual(state.nodes.f.children, ['f/Alpha', 'f/deep', 'f/a.sr.md', 'f/b.sr.md', 'f/note 9.sr.md', 'f/Note 10.sr.md'])
  scheduler.update([], [scheduler.create_note('f/b.sr.md', parse('Q:: changed').scheduling).note])
  assert.deepEqual(state.nodes.f.children, ['f/Alpha', 'f/deep', 'f/a.sr.md', 'f/b.sr.md', 'f/note 9.sr.md', 'f/Note 10.sr.md'])

  state.recount()
  const served = []
  for (let [path, ordinal] = scheduler.next_card('f'); path; [path, ordinal] = scheduler.next_card('f')) {
    served.push(path)
    scheduler.review(path, ordinal, 'tomorrow')
  }
  assert.deepEqual(served, ['f/Alpha/y.sr.md', 'f/deep/z.sr.md', 'f/a.sr.md', 'f/b.sr.md', 'f/note 9.sr.md', 'f/Note 10.sr.md'])
}

/**
 * Paths are exact: names that collate equally, by case or leading zeros, are distinct siblings, and names of Object
 * members such as `constructor` and `__proto__` are ordinary paths.
 */
export function test_paths_are_exact() {
  const collating = make_scheduler()
  for (const path of ['folder/b.sr.md', 'Folder/a.sr.md', 'folder/c.sr.md', 'folder1/d.sr.md', 'folder01/e.sr.md', 'Folder/f.sr.md']) {
    collating.update([], [collating.create_note(path, parse('Q:: x').scheduling).note])
  }
  assert.deepEqual(collating.state.nodes[''].children, ['Folder', 'folder', 'folder01', 'folder1'])
  assert.deepEqual(collating.state.nodes.Folder.children, ['Folder/a.sr.md', 'Folder/f.sr.md'])
  assert.deepEqual(collating.state.nodes.folder.children, ['folder/b.sr.md', 'folder/c.sr.md'])
  collating.update(['Folder/a.sr.md', 'Folder/f.sr.md', 'folder1/d.sr.md'], [])
  assert.deepEqual(collating.state.nodes[''].children, ['folder', 'folder01'])
  assert.deepEqual(Object.keys(collating.state.nodes).sort(), ['', 'folder', 'folder/b.sr.md', 'folder/c.sr.md', 'folder01', 'folder01/e.sr.md'])

  const members = make_scheduler()
  for (const path of ['constructor/a.sr.md', '__proto__/b.sr.md', 'toString/c.sr.md', 'hasOwnProperty.sr.md']) {
    members.update([], [members.create_note(path, parse('Q:: x').scheduling).note])
  }
  assert.deepEqual(members.state.nodes[''].children, ['__proto__', 'constructor', 'toString', 'hasOwnProperty.sr.md'])
  assert.deepEqual(members.state.nodes.constructor.children, ['constructor/a.sr.md'])
  members.state.recount()
  assert.deepEqual(get_counts(members.state.nodes['']), { due: 0, new: 4, later: 0 })
  members.update(['__proto__/b.sr.md'], [])
  assert.deepEqual(Object.keys(members.state.nodes).sort(), ['', 'constructor', 'constructor/a.sr.md', 'hasOwnProperty.sr.md', 'toString', 'toString/c.sr.md'])
}

/** A path holds a note or a folder: a note replacing a folder removes the folder's notes, and the reverse. */
export function test_a_path_holds_a_note_or_a_folder() {
  const scheduler = make_scheduler()
  const { state } = scheduler
  for (const path of ['x.sr.md/a.sr.md', 'x.sr.md/deep/b.sr.md', 'y.sr.md']) {
    scheduler.update([], [scheduler.create_note(path, parse('Q:: x').scheduling).note])
  }
  assert.deepEqual(state.nodes[''].children, ['x.sr.md', 'y.sr.md'])

  scheduler.update([], [scheduler.create_note('x.sr.md', parse('Q:: one\n\nQ:: two').scheduling).note])
  assert.deepEqual(Object.keys(state.nodes).sort(), ['', 'x.sr.md', 'y.sr.md'])
  assert.equal(state.nodes['x.sr.md'].type, NOTE)
  assert.deepEqual(state.nodes[''].children, ['x.sr.md', 'y.sr.md'])
  state.recount()
  assert.deepEqual(get_counts(state.nodes['']), { due: 0, new: 3, later: 0 })

  scheduler.update([], [scheduler.create_note('x.sr.md/c.sr.md', parse('Q:: x').scheduling).note])
  assert.deepEqual(Object.keys(state.nodes).sort(), ['', 'x.sr.md', 'x.sr.md/c.sr.md', 'y.sr.md'])
  assert.equal(state.nodes['x.sr.md'].type, FOLDER)
  assert.deepEqual(state.nodes[''].children, ['x.sr.md', 'y.sr.md'])
  assert.deepEqual(state.nodes['x.sr.md'].children, ['x.sr.md/c.sr.md'])
  state.recount()
  assert.deepEqual(get_counts(state.nodes['']), { due: 0, new: 2, later: 0 })
}

// Run every test_ function above as a test named after it.
for (const [name, fn] of Object.entries(tests)) if (name.startsWith('test_')) test(name, fn)
