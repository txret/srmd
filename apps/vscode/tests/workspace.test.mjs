// Loading, watching and settings (ARCHITECTURE.md, "VS Code host"): the workspace's notes, their problems, and srmd
// turned on and off, in the mocked VS Code of host.mjs.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { ThemeColor, folder_row, note_row, root_row, start_host, uri, wait_until } from './host.mjs'
import * as tests from './workspace.test.mjs'

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
 * Loading noncanonical references, new cards and orphan definitions leaves the file untouched.
 * Loading must build queues without normalizing source or allocating storage for fresh cards.
 */
export async function test_loading_leaves_the_files_untouched(t) {
  const source = `
Fresh:: first

Known:: second[:42]

[:42]: k 20261014040000 7 20261007120000 8.5 4.2 0 10 1
[:9]: n 0 0 0 0 0 0 0 0
`.slice(1)
  const host = await start_host(t, source, {})
  assert.deepEqual(host.files.get('/workspace/topic/a.sr.md'), { text: source, mtime: 1 })
  assert.deepEqual(host.state.nodes['topic/a.sr.md'].cards, [
    {
      ref: -1, state: 'n', due: '0', scheduled_days: 0, last_review: '0', stability: 0,
      difficulty: 0, learning_steps: 0, reps: 0, lapses: 0, ordinal: 1
    },
    {
      ref: 42, state: 'k', due: '20261014040000', scheduled_days: 7, last_review: '20261007120000', stability: 8.5,
      difficulty: 4.2, learning_steps: 0, reps: 10, lapses: 1, ordinal: 2
    }
  ])
}

/**
 * Loading and watching persist manual hints once while ordinary edits stay unchanged.
 * Save a load-time hint, ignore its watcher echo, then load an ordinary edit and a new hint. Only the hint's state
 * and due fields change: the identifier and the other fields stay as written, without renumbering.
 */
export async function test_hints_are_saved_once_and_ordinary_edits_never(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00:00+02:00') })
  const source = `
[:8]: 7d 0 0 0 0 0 0 0 0

Q:: answer[:8]
`.slice(1)
  const host = await start_host(t, source, { rollover: '04:30' })
  const path = '/workspace/topic/a.sr.md'
  const expected = `
[:8]: k 20261022043000 0 0 0 0 0 0 0

Q:: answer[:8]
`.slice(1)
  assert.deepEqual(host.files.get(path), { text: expected, mtime: 2 })
  host.changes.fire(uri(path))
  await delay(150)
  assert.deepEqual(host.files.get(path), { text: expected, mtime: 2 })
  const edited = `
[:8]: k 20261022043000 7 20261015120000 7 2.11810397 0 1 0

Q:: answer[:8]

Fresh:: new`.slice(1)
  host.files.set(path, { text: edited, mtime: 3 })
  host.changes.fire(uri(path))
  await wait_until(() => host.state.nodes['topic/a.sr.md'].cards.length === 2)
  assert.deepEqual(host.files.get(path), { text: edited, mtime: 3 })
  const hinted = `
[:8]: 2w 20261022043000 7 20261015120000 7 2.11810397 0 1 0

Q:: answer[:8]

Fresh:: new`.slice(1)
  host.files.set(path, { text: hinted, mtime: 4 })
  host.changes.fire(uri(path))
  await wait_until(() => host.files.get(path).mtime === 5)
  assert.equal(host.files.get(path).text,
    `
[:8]: k 20261029043000 7 20261015120000 7 2.11810397 0 1 0

Q:: answer[:8]

Fresh:: new`.slice(1))
}

/**
 * Notes with problems are logged, announced, marked in both views and the review tab, and keep their rows on load.
 * A review save removes duplicate and unmatched rows, so the user must notice them before a review saves the
 * note. Loading writes only a resolved hint's definition, which keeps those definitions.
 */
export async function test_notes_with_problems_are_logged_announced_and_marked(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00:00+02:00') })
  const problem = `
Q:: one[:1]

R:: two[:2]

S:: three

[:1]: ! 0 0 0 0 0 0 0 0
[:2]: k 20261034040000 7 20261007120000 8.5 4.2 0 10 1
[:2]: l 0 0 0 0 0 0 0 0
[:4]: k 20261014040000 7 20261007120000 8.5 4.2 0 10 1
`.slice(1)
  const host = await start_host(t, { 'topic/a.sr.md': problem, 'topic/b.sr.md': 'Q:: fine' }, {})
  // The resolved hint is written in place; the definitions on lines 9 and 10 stay for the user to look at.
  const resolved = problem.replace('[:1]: ! 0 0 0 0 0 0 0 0', '[:1]: k 20261022040000 0 0 0 0 0 0 0')
  assert.deepEqual(host.files.get('/workspace/topic/a.sr.md'), { text: resolved, mtime: 2 })
  const texts = [
    'Line 9: definition [:2] repeats an earlier one; saving a review removes it.',
    'Line 10: definition [:4] belongs to no cloze; saving a review removes it.',
    'Card 2 has an invalid due date, 20261034040000; it is not reviewed until the date is fixed.'
  ]
  assert.deepEqual(host.log, texts.map(text => ['warn', `topic/a.sr.md: ${text}`]))
  const announcement = 'Notes with problems: 1. Check them before reviewing, since saving a review can lose information.'
  assert.deepEqual(host.warnings, [[announcement, 'Show Log']])

  assert.deepEqual(host.rows(), [root_row([0, 2, 2], '⚠ ')])
  assert.deepEqual(host.rows(''), [folder_row('topic', [0, 2, 2], '⚠ ')])
  assert.deepEqual(host.rows('topic'), [note_row('topic/a.sr.md', [0, 1, 2], '⚠ '), note_row('topic/b.sr.md', [0, 1, 0])])
  const warning = new ThemeColor('list.warningForeground')
  assert.deepEqual(host.decoration('/workspace/topic/a.sr.md'), {
    badge: '⚠', tooltip: ['due: 0 • new: 1 • later: 2', ...texts].join('\n'), propagate: false, color: warning
  })
  assert.deepEqual(host.decoration('/workspace/topic'), {
    badge: '⚠', tooltip: 'due: 0 • new: 2 • later: 2\nNotes with problems: 1', propagate: false, color: warning
  })
  assert.deepEqual(host.decoration('/workspace/topic/b.sr.md'), { badge: '🔵', tooltip: 'due: 0 • new: 1 • later: 0', propagate: false })

  // The review tab lists the problems above the note.
  const pending = host.review()
  await wait_until(() => host.panel?.document)
  assert.equal(host.panel.cards[0].markup, readFileSync(`${import.meta.dirname}/problem-review.html`, 'utf8'))
  host.panel.dispose()
  await pending

  // A watcher batch announces only notes that gain problems; the action reveals the log. The edit of a, after the
  // hint save above, restores the hint, which its reload saves again.
  host.answer_warnings('Show Log')
  host.files.set('/workspace/topic/b.sr.md', { text: 'Q:: fine\n\n[:7]: n 0 0 0 0 0 0 0 0\n', mtime: 2 })
  host.files.set('/workspace/topic/a.sr.md', { text: problem + '\n', mtime: 3 })
  host.edits.fire(uri('/workspace/topic/b.sr.md'))
  host.edits.fire(uri('/workspace/topic/a.sr.md'))
  await wait_until(() => host.log.at(-1)?.[0] === 'show')
  assert.deepEqual(host.warnings, [[announcement, 'Show Log'], [announcement, 'Show Log']])
  assert.deepEqual(host.log.slice(3), [
    ['warn', 'topic/b.sr.md: Line 3: definition [:7] belongs to no cloze; saving a review removes it.'],
    ...texts.map(text => ['warn', `topic/a.sr.md: ${text}`]),
    ['show']
  ])

  await wait_until(() => host.files.get('/workspace/topic/a.sr.md').mtime === 4)
  assert.equal(host.files.get('/workspace/topic/a.sr.md').text, resolved + '\n')

  // A fixed note loses its marks.
  host.files.set('/workspace/topic/a.sr.md', { text: 'Q:: one', mtime: 5 })
  host.edits.fire(uri('/workspace/topic/a.sr.md'))
  await wait_until(() => host.state.nodes['topic/a.sr.md'].problems.length === 0)
  await wait_until(() => host.rows('topic')[0].description === 'd0 • n1 • l0')
  assert.deepEqual(host.rows('topic'), [note_row('topic/a.sr.md', [0, 1, 0]), note_row('topic/b.sr.md', [0, 1, 0], '⚠ ')])
  assert.deepEqual(host.rows(''), [folder_row('topic', [0, 2, 0], '⚠ ')])
  assert.equal(host.warnings.length, 2)
}

/**
 * Unreadable notes and failed hint writes are logged instead of vanishing silently.
 * Read failures skip the note during a reload; a failed hint write keeps the note loaded.
 */
export async function test_unreadable_notes_and_failed_hint_writes_are_logged(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00:00+02:00') })
  const host = await start_host(t, 'Q:: one', {})
  host.files.set('/workspace/bad.sr.md', { get text() { throw new Error('Permission denied') }, mtime: 1 })
  host.folders_changed()
  await wait_until(() => host.tree_changes.length === 2)
  assert.equal(host.state.nodes['bad.sr.md'], undefined)
  assert.deepEqual(host.log, [['error', 'Skipped bad.sr.md: Permission denied']])

  host.files.delete('/workspace/bad.sr.md')
  host.fail_writes(new Error('Disk is read-only'))
  host.files.set('/workspace/hint.sr.md', { text: '[:1]: 7d 0 0 0 0 0 0 0 0\n\nQ:: answer[:1]\n', mtime: 1 })
  host.changes.fire(uri('/workspace/hint.sr.md'))
  await wait_until(() => host.log.length === 2)
  assert.deepEqual(host.log[1], ['error', 'Unable to save resolved scheduling hints to hint.sr.md: Disk is read-only'])
  assert.equal(host.state.nodes['hint.sr.md'].cards[0].state, 'k')
}

/**
 * A failed read of a loaded note keeps its previous state and is logged, and a later change reloads it.
 * Only a confirmed absence may remove a note; denied access is not a deletion.
 */
export async function test_a_failed_read_keeps_the_note_and_a_later_change_reloads_it(t) {
  const host = await start_host(t, 'Q:: one', {})
  const path = '/workspace/topic/a.sr.md'
  host.files.set(path, { get text() { throw new Error('Permission denied') }, mtime: 2 })
  host.edits.fire(uri(path))
  await wait_until(() => host.log.length === 1)
  assert.deepEqual(host.log, [['error', 'Could not read topic/a.sr.md; keeping its previous state: Permission denied']])
  assert.equal(host.state.nodes['topic/a.sr.md'].cards.length, 1)

  host.files.set(path, { text: 'Q:: one\n\nQ:: two', mtime: 3 })
  host.edits.fire(uri(path))
  await wait_until(() => host.state.nodes['topic/a.sr.md'].cards.length === 2)
}

/**
 * A folder and a file swapping names leave no stale notes or folders in the tree.
 * Each swap reports only the swapped path; the batch must classify it by what is on disk now.
 */
export async function test_folders_and_files_swapping_names_leave_nothing_stale(t) {
  const host = await start_host(t, {
    'x.sr.md/a.sr.md': 'Q:: one', 'x.sr.md/deep/b.sr.md': 'Q:: two', 'y/c.sr.md': 'Q:: three', 'z/d.sr.md': 'Q:: four',
    'topic/a.sr.md': 'Q:: five'
  }, {})
  /** Replace files on disk, then report the given deletions and creations as one watcher batch. */
  const swap = async (remove, add, deleted, created) => {
    const batches = host.tree_changes.length
    for (const name of remove) host.files.delete(`/workspace/${name}`)
    for (const [name, text] of Object.entries(add)) host.files.set(`/workspace/${name}`, { text, mtime: 1 })
    for (const name of deleted) host.deletions.fire(uri(`/workspace/${name}`))
    for (const name of created) host.changes.fire(uri(`/workspace/${name}`))
    await wait_until(() => host.tree_changes.length === batches + 1)
  }

  // A folder named like a note becomes a note.
  await swap(['x.sr.md/a.sr.md', 'x.sr.md/deep/b.sr.md'], { 'x.sr.md': 'Q:: six\n\nQ:: seven' }, ['x.sr.md'], ['x.sr.md'])
  assert.deepEqual(Object.keys(host.state.nodes).sort(), ['', 'topic', 'topic/a.sr.md', 'x.sr.md', 'y', 'y/c.sr.md', 'z', 'z/d.sr.md'])
  assert.deepEqual(host.rows(''), [
    folder_row('topic', [0, 1, 0]), folder_row('y', [0, 1, 0]), folder_row('z', [0, 1, 0]), note_row('x.sr.md', [0, 2, 0])
  ])

  // A note becomes a folder without notes; its parent folder is left empty and pruned.
  await swap(['topic/a.sr.md'], { 'topic/a.sr.md/readme.txt': 'plain' }, ['topic/a.sr.md'], ['topic/a.sr.md'])
  assert.deepEqual(Object.keys(host.state.nodes).sort(), ['', 'x.sr.md', 'y', 'y/c.sr.md', 'z', 'z/d.sr.md'])

  // A folder becomes a plain file, reported only by its own path.
  await swap(['y/c.sr.md'], { y: 'plain' }, ['y'], ['y'])
  assert.deepEqual(Object.keys(host.state.nodes).sort(), ['', 'x.sr.md', 'z', 'z/d.sr.md'])

  // A note below a folder that became a file is reported; lying below a file, it is gone.
  await swap(['z/d.sr.md'], { z: 'plain' }, ['z/d.sr.md'], [])
  assert.deepEqual(Object.keys(host.state.nodes).sort(), ['', 'x.sr.md'])

  // The note becomes a folder of notes again.
  await swap(['x.sr.md'], { 'x.sr.md/new.sr.md': 'Q:: eight' }, ['x.sr.md'], ['x.sr.md'])
  assert.deepEqual(Object.keys(host.state.nodes).sort(), ['', 'x.sr.md', 'x.sr.md/new.sr.md'])
  assert.deepEqual(host.rows(''), [folder_row('x.sr.md', [0, 1, 0])])
  assert.deepEqual(host.log, [])
}

/**
 * Deleting a folder removes every note below it, although only the folder is reported.
 * VS Code coalesces a folder deletion into one event for the folder itself.
 */
export async function test_deleting_a_folder_removes_its_notes(t) {
  const host = await start_host(t, { 'topic/a.sr.md': 'Q:: one', 'topic/deep/b.sr.md': 'Q:: two', 'other/c.sr.md': 'Q:: three' }, {})
  host.files.delete('/workspace/topic/a.sr.md')
  host.files.delete('/workspace/topic/deep/b.sr.md')
  host.deletions.fire(uri('/workspace/topic'))
  await wait_until(() => host.tree_changes.length === 2)
  assert.deepEqual(Object.keys(host.state.nodes).sort(), ['', 'other', 'other/c.sr.md'])
  assert.deepEqual(host.rows(''), [folder_row('other', [0, 1, 0])])
  assert.deepEqual(host.contexts.get('srmd.reviewResources'), {
    'file:///workspace': true, 'file:///workspace/other': true, 'file:///workspace/other/c.sr.md': true
  })
}

/**
 * Renaming a folder moves its notes with their scheduling, although only the folders are reported.
 * A rename is reported as the old folder's deletion and the new folder's creation.
 */
export async function test_renaming_a_folder_moves_its_notes(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00:00+02:00') })
  const scheduled = `
Q:: one[:1]

[:1]: k 20261014040000 7 20261007120000 8.5 4.2 0 10 1
`.slice(1)
  const host = await start_host(t, { 'topic/a.sr.md': scheduled, 'topic/deep/b.sr.md': 'Q:: two' }, {})
  host.files.delete('/workspace/topic/a.sr.md')
  host.files.delete('/workspace/topic/deep/b.sr.md')
  host.files.set('/workspace/renamed/a.sr.md', { text: scheduled, mtime: 1 })
  host.files.set('/workspace/renamed/deep/b.sr.md', { text: 'Q:: two', mtime: 1 })
  host.deletions.fire(uri('/workspace/topic'))
  host.changes.fire(uri('/workspace/renamed'))
  await wait_until(() => host.tree_changes.length === 2)
  assert.deepEqual(Object.keys(host.state.nodes).sort(), ['', 'renamed', 'renamed/a.sr.md', 'renamed/deep', 'renamed/deep/b.sr.md'])
  assert.deepEqual(host.rows(''), [folder_row('renamed', [1, 1, 0])])
  assert.equal(host.state.nodes['renamed/a.sr.md'].cards[0].due, '20261014040000')
}

/**
 * Creating or deleting other files changes nothing.
 * The structure watcher reports every path; only notes and folders matter.
 */
export async function test_other_files_change_nothing(t) {
  const host = await start_host(t, 'Q:: one', {})
  host.files.set('/workspace/readme.txt', { text: 'Q:: not a note', mtime: 1 })
  host.changes.fire(uri('/workspace/readme.txt'))
  host.deletions.fire(uri('/workspace/old.txt'))
  await delay(150)
  assert.deepEqual(host.tree_changes, [undefined])
  assert.deepEqual(Object.keys(host.state.nodes).sort(), ['', 'topic', 'topic/a.sr.md'])
}

/**
 * A symbolic link to a note loads like the note itself.
 * VS Code reports File | SymbolicLink; only the folder bit decides between folders and files.
 */
export async function test_a_symbolic_link_to_a_note_loads_like_the_note(t) {
  const host = await start_host(t, 'Q:: one', {})
  host.files.set('/workspace/linked.sr.md', { text: 'Q:: linked', mtime: 1, symlink: true })
  host.changes.fire(uri('/workspace/linked.sr.md'))
  await wait_until(() => host.state.nodes['linked.sr.md'])
  assert.equal(host.state.nodes['linked.sr.md'].cards.length, 1)
}

/**
 * Watcher batches run one at a time, so the newest version of a note is applied last.
 * Hold the first batch's read, report a newer version, and require the second batch to wait.
 */
export async function test_watcher_batches_run_one_at_a_time(t) {
  const host = await start_host(t, 'Q:: one', {})
  const path = '/workspace/topic/a.sr.md'
  const reads = host.pause_reads()
  host.files.set(path, { text: 'Q:: two\n\nQ:: three', mtime: 2 })
  host.edits.fire(uri(path))
  await wait_until(() => reads.pending === 1)
  host.files.set(path, { text: 'Q:: four', mtime: 3 })
  host.edits.fire(uri(path))
  await delay(150)
  assert.equal(reads.pending, 1)
  reads.release()
  await wait_until(() => host.tree_changes.length === 3)
  assert.deepEqual(host.state.nodes['topic/a.sr.md'].cards.length, 1)
}

/**
 * A workspace-folder change during a review save leaves the watcher working.
 * The reload waits for the save; afterwards a created note must still load.
 */
export async function test_a_folder_change_during_a_save_leaves_the_watcher_working(t) {
  const host = await start_host(t, 'Q:: one', {})
  host.review()
  await wait_until(() => host.panel?.document)
  const finish_write = host.pause_writes()
  host.panel.reply('tomorrow')
  await wait_until(() => host.writing)
  host.folders_changed()
  await delay(20)
  finish_write()
  await wait_until(() => !host.writing)
  host.files.set('/workspace/new.sr.md', { text: 'Q:: new', mtime: 1 })
  host.changes.fire(uri('/workspace/new.sr.md'))
  await wait_until(() => host.state.nodes['new.sr.md'])
  host.panel.dispose()
}

/**
 * Closing the folder during a load leaves no notes from that load.
 * Hold the reload's read, close the workspace, then let the reload finish first.
 */
export async function test_closing_the_folder_during_a_load_leaves_no_notes(t) {
  const host = await start_host(t, { 'topic/a.sr.md': 'Q:: one', 'topic/b.sr.md': 'Q:: two' }, {})
  const reads = host.pause_reads()
  host.folders_changed()
  await wait_until(() => reads.pending > 0)
  host.close_workspace()
  await delay(20)
  reads.release()
  await wait_until(() => host.tree_changes.length === 3)
  assert.deepEqual(Object.keys(host.state.nodes), [])
  assert.deepEqual(host.rows(), [])
}

/**
 * A load that crosses the review day's rollover counts its notes for the new day.
 * Notes build their queues as they load. Hold the reload's hint write, so its notes are built before 04:00, and
 * let the clock pass the rollover before the counts are published: the card due later today becomes due.
 */
export async function test_a_load_across_the_rollover_counts_for_the_new_day(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T03:59:00+02:00') })
  const due_today = `
Q:: answer[:1]

[:1]: k 20261015170000 1 20261014120000 8.5 4.2 0 10 1
`.slice(1)
  const host = await start_host(t, { 'topic/a.sr.md': due_today, 'topic/b.sr.md': 'Q:: b' }, {})
  assert.deepEqual(host.decoration('/workspace/topic/a.sr.md'), { badge: '🟢', tooltip: 'due: 0 • new: 0 • later: 1', propagate: false })
  // An edit outside srmd adds a hint, which the reload resolves and writes.
  host.files.set('/workspace/topic/b.sr.md', { text: 'Q:: b[:1]\n\n[:1]: 3d\n', mtime: 2 })
  const finish_write = host.pause_writes()
  host.folders_changed()
  await wait_until(() => host.writing)
  t.mock.timers.tick(2 * 60_000)
  finish_write()
  await wait_until(() => host.files.get('/workspace/topic/b.sr.md').mtime === 3 && !host.writing)
  await wait_until(() => host.decoration('/workspace/topic/a.sr.md')?.badge === '🔴')
  assert.deepEqual(host.decoration('/workspace/topic/a.sr.md'), { badge: '🔴', tooltip: 'due: 1 • new: 0 • later: 0', propagate: false })
}

/**
 * A multi-root workspace loads only its first folder and says so in the log.
 * Add a second folder; the reload keeps the first folder's notes.
 */
export async function test_a_multi_root_workspace_loads_its_first_folder(t) {
  const host = await start_host(t, 'Q:: one', {})
  host.add_folder('/second', 'second')
  await wait_until(() => host.tree_changes.length === 2)
  assert.deepEqual(host.log, [['info', 'srmd loads only the first workspace folder, workspace.']])
  assert.deepEqual(Object.keys(host.state.nodes).sort(), ['', 'topic', 'topic/a.sr.md'])
}

/**
 * Changed settings apply without reloading the extension.
 * New suffixes reload the folder, the rollover reaches the scheduler, and an open tab gets the display settings.
 */
export async function test_changed_settings_apply_without_reloading(t) {
  const host = await start_host(t, { 'topic/a.sr.md': 'Q:: one', 'b.cards.md': 'Q:: two' }, {})
  host.review(uri('/workspace/topic/a.sr.md'))
  await wait_until(() => host.panel?.document)
  host.change_settings({ suffixes: ['.cards.md'], rollover: '05:00', 'inactive.front': true })
  await wait_until(() => host.state.nodes['b.cards.md'])
  assert.deepEqual(Object.keys(host.state.nodes).sort(), ['', 'b.cards.md'])
  assert.equal(host.state.config.rollover, 5 * 3600000)
  const config = host.panel.webview.html.match(/data-config="([^"]*)"/)[1].replace(/&quot;/g, '"')
  assert.deepEqual(JSON.parse(config), {
    shortcuts: { next: 'PageDown', previous: 'PageUp', default: ' ', back: 'Backspace', search: 'ctrl+f' },
    labels: { show_back: 'Back', show_front: 'Front', open_search: 'Search', search_hint: 'Search...', do_search: 'Search' },
    inactive: { front: true, back: false },
    night_mode: false
  })
  assert.deepEqual(host.panel.cards.map(card => card.id), [1, 1])
  host.panel.dispose()
}

/**
 * A queue order listing every queue once is applied.
 * New cards first: the new card is served although a due card exists.
 */
export async function test_a_queue_order_listing_every_queue_once_is_applied(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00:00+02:00') })
  const host = await start_host(t, row_notes, { queueOrder: ['new', 'intraday', 'interday'] })
  assert.deepEqual(host.state.config.queue_order, ['new', 'intraday', 'interday'])
  host.review(uri('/workspace/topic/a.sr.md'))
  await wait_until(() => host.panel?.document)
  assert.deepEqual(host.panel.document.active_ordinals(), [1])
  assert.deepEqual(host.log, [])
  host.panel.dispose()
}

/**
 * Invalid queue order, rollover and extensions settings are logged and replaced by their defaults.
 * A queue order missing queues would leave due cards unserved; an unknown extension leaves notes plain.
 */
export async function test_invalid_settings_are_logged_and_replaced_by_defaults(t) {
  const host = await start_host(t, 'Q:: one', { queueOrder: ['new'], rollover: '25:00', extensions: ['foam-placeholders', 'nope'] })
  assert.deepEqual(host.state.config.queue_order, ['intraday', 'interday', 'new'])
  assert.equal(host.state.config.rollover, 4 * 3600000)
  assert.deepEqual(host.log, [
    ['warn', 'Ignored invalid setting srmd.queueOrder; using its default.'],
    ['warn', 'Ignored invalid setting srmd.rollover; using its default.'],
    ['warn', 'Ignored invalid setting srmd.extensions; using its default.']
  ])
}

/**
 * Srmd stays off until turned on, then loads the folder, and turning it off unloads everything.
 * Off must cost nothing: no file search, no watcher, no rows, badges or Review menu, only the status bar item.
 */
export async function test_srmd_stays_off_until_turned_on_and_off_unloads_everything(t) {
  const host = await start_host(t, 'Q:: one', { enabled: false })
  const off = {
    name: 'srmd', text: '$(circle-slash) srmd', command: 'srmd.toggle', visible: true,
    tooltip: 'srmd is off in this workspace. Click to turn it on and load its notes.'
  }
  assert.deepEqual([host.searches, host.watchers], [0, 0])
  assert.deepEqual(Object.keys(host.state.nodes), [])
  assert.deepEqual(host.rows(), [])
  assert.equal(host.decoration('/workspace/topic/a.sr.md'), undefined)
  assert.deepEqual(host.contexts.get('srmd.reviewResources'), {})
  assert.deepEqual(host.status, off)

  // A status bar click turns it on in the workspace settings, which loads and watches the folder.
  await host.command('srmd.toggle')
  await wait_until(() => host.state.nodes['topic/a.sr.md'])
  assert.deepEqual(host.config_updates, [['enabled', true, 2]])
  assert.deepEqual([host.searches, host.watchers], [1, 2])
  assert.deepEqual(host.rows(''), [folder_row('topic', [0, 1, 0])])
  assert.deepEqual(host.decoration('/workspace/topic/a.sr.md'), { badge: '🔵', tooltip: 'due: 0 • new: 1 • later: 0', propagate: false })
  assert.deepEqual(host.status, {
    ...off, text: '$(mortar-board) srmd', tooltip: 'srmd is on in this workspace. Click to turn it off.'
  })

  // Turning it off from the palette also ends a review in progress.
  const pending = host.review()
  await wait_until(() => host.panel?.document)
  await host.command('srmd.disable')
  // Waiting with a time limit, so a tab left open fails the test instead of stalling it.
  await wait_until(() => host.panel.disposed)
  await pending
  await wait_until(() => !host.state.nodes[''])
  assert.deepEqual(host.config_updates, [['enabled', true, 2], ['enabled', false, 2]])
  assert.deepEqual([host.searches, host.watchers], [1, 0])
  assert.deepEqual(host.rows(), [])
  assert.equal(host.decoration('/workspace/topic/a.sr.md'), undefined)
  assert.deepEqual(host.contexts.get('srmd.reviewResources'), {})
  assert.deepEqual(host.status, off)
  // Off, workspace changes and other settings search nothing either.
  host.folders_changed()
  host.change_settings({ rollover: '05:00' })
  await delay(20)
  assert.deepEqual([host.searches, host.watchers], [1, 0])
  assert.deepEqual(host.files.get('/workspace/topic/a.sr.md'), { text: 'Q:: one', mtime: 1 })
}

/**
 * Turning srmd on without an open folder asks for one and writes no setting.
 * The setting is written for the workspace; an empty window has none, and its status bar item is hidden.
 */
export async function test_turning_srmd_on_without_a_folder_asks_for_one(t) {
  const host = await start_host(t, 'Q:: one', { enabled: false })
  host.close_workspace()
  assert.equal(host.status.visible, false)
  await host.command('srmd.enable')
  assert.deepEqual(host.infos, ['Open a folder to use srmd.'])
  assert.deepEqual(host.config_updates, [])
}

/**
 * Disposing the host disposes its watcher and can be repeated.
 */
export async function test_disposing_the_extension_disposes_its_watcher(t) {
  const source = `
No clozes`.slice(1)
  const host = await start_host(t, source, {})
  assert.equal(host.watcher_disposed, false)
  host.dispose()
  assert.equal(host.watcher_disposed, true)
  assert.equal(host.decorations_disposed, true)
  assert.equal(host.tree_disposed, true)
  host.dispose()
  assert.equal(host.watcher_disposed, true)
  assert.equal(host.files.get('/workspace/topic/a.sr.md').text, 'No clozes')
}

// Run every test_ function above as a test named after it.
for (const [name, fn] of Object.entries(tests)) if (name.startsWith('test_')) test(name, fn)
