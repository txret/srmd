// The file tree (ARCHITECTURE.md, "Workspace"): file kinds and the visible rows of every file with note counts.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Scheduler } from '../../scheduler/src/index.ts'
import { parse } from '../../parser/src/index.ts'
import { note_from_parse } from '../../reviewer/src/index.ts'
import { file_kind, folder_children, tree_rows } from '../src/index.ts'
import * as tests from './files.test.mjs'

/** A scheduler state holding notes built from texts by path, counted. */
function notes_state(texts) {
  const scheduler = new Scheduler()
  scheduler.load('/notes')
  for (const [path, text] of Object.entries(texts)) scheduler.update([], [note_from_parse(scheduler, path, parse(text)).note])
  scheduler.state.recount()
  return scheduler.state
}

/** File listing entries for paths; times and sizes do not matter to the tree. */
const entries = paths => paths.map(path => ({ path, mtime: 1, size: 1 }))

/** The kind of every test file: notes by suffix, then Markdown and text extensions. */
const kinds = path => file_kind(path, ['.sr.md'], { markdown: ['.md'], text: ['.txt'] })

/**
 * A note suffix decides first, though `.sr.md` also ends in a Markdown extension; extensions ignore case, and a name
 * whose only dot starts it has none.
 */
export function test_a_files_kind_follows_note_suffixes_then_extensions() {
  const types = { markdown: ['.md', '.markdown'], text: ['.txt'] }
  assert.equal(file_kind('topic/a.sr.md', ['.sr.md'], types), 'note')
  assert.equal(file_kind('topic/a.SR.md', ['.sr.md'], types), 'markdown')
  assert.equal(file_kind('README.MARKDOWN', ['.sr.md'], types), 'markdown')
  assert.equal(file_kind('log.Txt', ['.sr.md'], types), 'text')
  assert.equal(file_kind('diagram.png', ['.sr.md'], types), 'other')
  assert.equal(file_kind('.md', ['.sr.md'], types), 'other')
  assert.equal(file_kind('Makefile', ['.sr.md'], types), 'other')
}

/**
 * Rows list the workspace folder, then expanded folders' children depth first: folders before files, names ignoring
 * case and comparing numbers by value. Notes and folders holding notes show counts, even zero; other files none.
 */
export function test_rows_list_expanded_folders_in_display_order_with_note_counts() {
  const state = notes_state({ 'topic/a.sr.md': 'Q:: one\n\nR:: two', 'b10.sr.md': 'Q:: x', 'b9.sr.md': 'No cards.' })
  const children = folder_children(entries([
    'topic/a.sr.md', 'topic/diagram.png', 'b10.sr.md', 'b9.sr.md', 'readme.md', 'Zeta/notes.txt', 'Zeta/sub/deep.md'
  ]))
  assert.deepEqual(tree_rows(state, children, 'notes', kinds, { topic: true }), [
    { path: '', name: 'notes', depth: 0, kind: 'folder', expanded: true, problems: false, counts: { due: 0, new: 3, later: 0 } },
    { path: 'topic', name: 'topic', depth: 1, kind: 'folder', expanded: true, problems: false, counts: { due: 0, new: 2, later: 0 } },
    { path: 'topic/a.sr.md', name: 'a.sr.md', depth: 2, kind: 'note', expanded: false, problems: false, counts: { due: 0, new: 2, later: 0 } },
    { path: 'topic/diagram.png', name: 'diagram.png', depth: 2, kind: 'other', expanded: false, problems: false },
    { path: 'Zeta', name: 'Zeta', depth: 1, kind: 'folder', expanded: false, problems: false },
    { path: 'b9.sr.md', name: 'b9.sr.md', depth: 1, kind: 'note', expanded: false, problems: false, counts: { due: 0, new: 0, later: 0 } },
    { path: 'b10.sr.md', name: 'b10.sr.md', depth: 1, kind: 'note', expanded: false, problems: false, counts: { due: 0, new: 1, later: 0 } },
    { path: 'readme.md', name: 'readme.md', depth: 1, kind: 'markdown', expanded: false, problems: false }
  ])
}

/**
 * A search's rows are its matching files, with their text match counts, below their folders, all expanded whatever
 * was expanded before; folders without a match are left out. A note with problems marks itself and its folders.
 */
export function test_a_search_shows_only_matching_files_below_expanded_folders() {
  const state = notes_state({ 'Zeta/a.sr.md': 'Q:: one\n\n[:9]: k 20261014040000 7 20261007120000 8.5 4.2 0 10 1' })
  const children = folder_children(entries(['Zeta/a.sr.md', 'Zeta/sub/deep.md', 'Zeta/sub/other.md', 'topic/x.md', 'b.txt']))
  assert.deepEqual(tree_rows(state, children, 'notes', kinds, { topic: true }, { 'Zeta/sub/deep.md': 2, 'Zeta/a.sr.md': 0 }), [
    { path: '', name: 'notes', depth: 0, kind: 'folder', expanded: true, problems: true, counts: { due: 0, new: 1, later: 0 } },
    { path: 'Zeta', name: 'Zeta', depth: 1, kind: 'folder', expanded: true, problems: true, counts: { due: 0, new: 1, later: 0 } },
    { path: 'Zeta/sub', name: 'sub', depth: 2, kind: 'folder', expanded: true, problems: false },
    { path: 'Zeta/sub/deep.md', name: 'deep.md', depth: 3, kind: 'markdown', expanded: false, problems: false, matches: 2 },
    { path: 'Zeta/a.sr.md', name: 'a.sr.md', depth: 2, kind: 'note', expanded: false, problems: true, counts: { due: 0, new: 1, later: 0 }, matches: 0 }
  ])
}

// Run every test_ function above as a test named after it.
for (const [name, fn] of Object.entries(tests)) if (name.startsWith('test_')) test(name, fn)
