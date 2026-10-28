// The Flashcards view and the Explorer's badges (ARCHITECTURE.md, "Tree and Explorer"), in the mocked VS Code of
// host.mjs.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ThemeIcon, folder_row, note_row, root_row, start_host, uri, wait_until } from './host.mjs'
import * as tests from './views.test.mjs'

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
 * Edit opens a note as a normal tab in the active editor group; a folder has nothing to edit.
 * Edit a note from its button and another with Ctrl+Enter, then try both on folders; no review opens.
 */
export async function test_edit_opens_a_note_as_a_normal_tab(t) {
  const host = await start_host(t, row_notes, {})
  await host.edit_row('topic/a.sr.md')
  host.select('other/c.sr.md')
  await host.press_ctrl_enter()
  host.select('other')
  await host.press_ctrl_enter()
  await host.edit_row('topic')
  assert.deepEqual(host.opened.map(({ path, options }) => [path, options]), [
    ['/workspace/topic/a.sr.md', { viewColumn: -1, preview: false }],
    ['/workspace/other/c.sr.md', { viewColumn: -1, preview: false }]
  ])
  assert.deepEqual(host.panels, [])
}

/**
 * Reveal in Explorer reveals the row's note or folder there.
 */
export async function test_reveal_in_explorer_reveals_the_row_there(t) {
  const host = await start_host(t, row_notes, {})
  await host.reveal_row('topic/a.sr.md')
  await host.reveal_row('other')
  assert.deepEqual(host.explorer_reveals, ['/workspace/topic/a.sr.md', '/workspace/other'])
}

/**
 * The visible view selects the active editor's note without taking focus.
 * Switch to a note's editor, then to a file that is no note and to none: only the note is selected. Hidden,
 * the view ignores a switch until it shows again. Revealing needs each row's parent, up to the open folder's row.
 */
export async function test_the_visible_view_selects_the_active_editor_s_note(t) {
  const host = await start_host(t, { ...row_notes, 'topic/plain.md': 'Not a note' }, {})
  const selected = { select: true, focus: false, expand: true }
  host.activate_editor('/workspace/topic/a.sr.md')
  host.activate_editor('/workspace/topic/plain.md')
  host.activate_editor(undefined)
  assert.deepEqual(host.tree_reveals, [['topic/a.sr.md', selected]])
  host.set_view_visible(false)
  host.activate_editor('/workspace/other/c.sr.md')
  assert.deepEqual(host.tree_reveals, [['topic/a.sr.md', selected]])
  host.set_view_visible(true)
  assert.deepEqual(host.tree_reveals, [['topic/a.sr.md', selected], ['other/c.sr.md', selected]])
  assert.deepEqual(['topic/a.sr.md', 'topic', ''].map(path => host.tree.getParent(host.state.nodes[path])?.path), ['topic', '', undefined])
}

/**
 * The view lists the open folder, then its folders before its notes, names ignoring case and comparing numbers by
 * value, each with the due, new and later counts of everything below it. The Explorer badges a resource red with due
 * cards, blue with only new ones and green with only later ones; nothing without cards, outside the notes or the
 * folder. A learning card due later today counts as later until its exact due time.
 */
export async function test_the_view_and_the_explorer_count_every_descendant(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00:00+02:00') })
  const host = await start_host(t, {
    'due/deep/mixed.sr.md': `
Due:: first[:1]

Fresh:: second

[:1]: k 20261014040000 7 20261007120000 8.5 4.2 0 10 1
`.slice(1),
    'later/scheduled.sr.md': `
Tomorrow:: first[:1]

Learning:: second[:2]

[:1]: k 20261016040000 1 20261015110000 8.5 4.2 0 10 1
[:2]: l 20261015121000 0 20261015120000 2.3065 2.11810397 1 1 0
`.slice(1),
    'new/fresh.sr.md': 'Q:: new',
    'empty/blank.sr.md': 'No clozes',
    'Note 10.sr.md': 'Q:: ten',
    'note 9.sr.md': 'Q:: nine',
    'ordinary.md': 'Q:: excluded by suffix'
  }, {})
  assert.deepEqual(host.rows(), [
    {
      label: 'workspace', collapsibleState: 2, id: 'file:///workspace', resourceUri: uri('/workspace'), iconPath: ThemeIcon.Folder,
      description: 'd1 • n4 • l2', contextValue: 'folder'
    }
  ])
  assert.deepEqual(host.rows(''), [
    {
      label: 'due', collapsibleState: 1, id: 'file:///workspace/due', resourceUri: uri('/workspace/due'), iconPath: ThemeIcon.Folder,
      description: 'd1 • n1 • l0', contextValue: 'folder'
    },
    {
      label: 'empty', collapsibleState: 1, id: 'file:///workspace/empty', resourceUri: uri('/workspace/empty'), iconPath: ThemeIcon.Folder,
      description: 'd0 • n0 • l0', contextValue: 'folder'
    },
    {
      label: 'later', collapsibleState: 1, id: 'file:///workspace/later', resourceUri: uri('/workspace/later'), iconPath: ThemeIcon.Folder,
      description: 'd0 • n0 • l2', contextValue: 'folder'
    },
    {
      label: 'new', collapsibleState: 1, id: 'file:///workspace/new', resourceUri: uri('/workspace/new'), iconPath: ThemeIcon.Folder,
      description: 'd0 • n1 • l0', contextValue: 'folder'
    },
    {
      label: 'note 9.sr.md', collapsibleState: 0, id: 'file:///workspace/note 9.sr.md', resourceUri: uri('/workspace/note 9.sr.md'), iconPath: ThemeIcon.File,
      description: 'd0 • n1 • l0', contextValue: 'note'
    },
    {
      label: 'Note 10.sr.md', collapsibleState: 0, id: 'file:///workspace/Note 10.sr.md', resourceUri: uri('/workspace/Note 10.sr.md'), iconPath: ThemeIcon.File,
      description: 'd0 • n1 • l0', contextValue: 'note'
    }
  ])
  assert.deepEqual(host.rows('due'), [folder_row('due/deep', [1, 1, 0])])
  assert.deepEqual(host.rows('due/deep'), [note_row('due/deep/mixed.sr.md', [1, 1, 0])])
  assert.deepEqual(host.rows('empty'), [note_row('empty/blank.sr.md', [0, 0, 0])])
  assert.deepEqual(host.rows('later'), [note_row('later/scheduled.sr.md', [0, 0, 2])])

  // Folders are asked for before their children, as VS Code asks.
  assert.deepEqual(host.decoration('/workspace'), { badge: '🔴', tooltip: 'due: 1 • new: 4 • later: 2', propagate: false })
  const red = { badge: '🔴', tooltip: 'due: 1 • new: 1 • later: 0', propagate: false }
  assert.deepEqual(['/workspace/due', '/workspace/due/deep', '/workspace/due/deep/mixed.sr.md'].map(host.decoration), [red, red, red])
  const blue = { badge: '🔵', tooltip: 'due: 0 • new: 1 • later: 0', propagate: false }
  assert.deepEqual(['/workspace/new', '/workspace/new/fresh.sr.md', '/workspace/note 9.sr.md'].map(host.decoration), [blue, blue, blue])
  const green = { badge: '🟢', tooltip: 'due: 0 • new: 0 • later: 2', propagate: false }
  assert.deepEqual(['/workspace/later', '/workspace/later/scheduled.sr.md'].map(host.decoration), [green, green])
  assert.deepEqual(['/workspace/empty', '/workspace/empty/blank.sr.md', '/workspace/ordinary.md', '/other/due/deep/mixed.sr.md'].map(host.decoration),
    [undefined, undefined, undefined, undefined])

  // The Explorer menu offers Review on what holds cards.
  assert.deepEqual(host.contexts.get('srmd.reviewResources'), {
    'file:///workspace': true,
    'file:///workspace/due': true,
    'file:///workspace/due/deep': true,
    'file:///workspace/due/deep/mixed.sr.md': true,
    'file:///workspace/later': true,
    'file:///workspace/later/scheduled.sr.md': true,
    'file:///workspace/new': true,
    'file:///workspace/new/fresh.sr.md': true,
    'file:///workspace/Note 10.sr.md': true,
    'file:///workspace/note 9.sr.md': true
  })
  assert.deepEqual([host.tree_changes, host.decoration_changes], [[undefined], [undefined]])
}

/**
 * As notes are deleted, every ancestor's counts follow, and its badge falls back from due to new to later to none;
 * folders left without notes leave the view. Sibling branches keep their own badges.
 */
export async function test_ancestors_follow_deletions_in_the_view_and_the_explorer(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00:00+02:00') })
  const host = await start_host(t, {
    'subjects/science/due/deep/a.sr.md': `
Q:: due[:1]

[:1]: k 20261014040000 7 20261007120000 8.5 4.2 0 10 1
`.slice(1),
    'subjects/science/new/b.sr.md': 'Q:: new',
    'subjects/science/future/c.sr.md': `
Q:: future[:1]

[:1]: k 20261016040000 1 20261015120000 8.5 4.2 0 10 1
`.slice(1)
  }, {})
  /** The badges of the folders above every note. */
  const ancestors = () => ['/workspace', '/workspace/subjects', '/workspace/subjects/science'].map(host.decoration)
  /** Delete a note and wait for the batch that removes it. */
  const remove = async path => {
    const batches = host.tree_changes.length
    host.files.delete(`/workspace/${path}`)
    host.deletions.fire(uri(`/workspace/${path}`))
    await wait_until(() => host.tree_changes.length === batches + 1 && host.decoration_changes.length === batches + 1)
  }

  const red = { badge: '🔴', tooltip: 'due: 1 • new: 1 • later: 1', propagate: false }
  assert.deepEqual(ancestors(), [red, red, red])
  assert.deepEqual(host.decoration('/workspace/subjects/science/new'), { badge: '🔵', tooltip: 'due: 0 • new: 1 • later: 0', propagate: false })
  assert.deepEqual(host.decoration('/workspace/subjects/science/future'), { badge: '🟢', tooltip: 'due: 0 • new: 0 • later: 1', propagate: false })
  assert.deepEqual(host.rows(''), [folder_row('subjects', [1, 1, 1])])
  assert.deepEqual(host.rows('subjects'), [folder_row('subjects/science', [1, 1, 1])])
  assert.deepEqual(host.rows('subjects/science'), [
    folder_row('subjects/science/due', [1, 0, 0]),
    folder_row('subjects/science/future', [0, 0, 1]),
    folder_row('subjects/science/new', [0, 1, 0])
  ])

  await remove('subjects/science/due/deep/a.sr.md')
  const blue = { badge: '🔵', tooltip: 'due: 0 • new: 1 • later: 1', propagate: false }
  assert.deepEqual(ancestors(), [blue, blue, blue])
  assert.equal(host.decoration('/workspace/subjects/science/due'), undefined)
  assert.deepEqual(host.rows('subjects'), [folder_row('subjects/science', [0, 1, 1])])
  assert.deepEqual(host.rows('subjects/science'), [
    folder_row('subjects/science/future', [0, 0, 1]),
    folder_row('subjects/science/new', [0, 1, 0])
  ])

  await remove('subjects/science/new/b.sr.md')
  const green = { badge: '🟢', tooltip: 'due: 0 • new: 0 • later: 1', propagate: false }
  assert.deepEqual(ancestors(), [green, green, green])
  assert.deepEqual(host.rows(''), [folder_row('subjects', [0, 0, 1])])
  assert.deepEqual(host.rows('subjects/science'), [folder_row('subjects/science/future', [0, 0, 1])])

  await remove('subjects/science/future/c.sr.md')
  assert.deepEqual(ancestors(), [undefined, undefined, undefined])
  assert.deepEqual(host.rows(), [root_row([0, 0, 0])])
  assert.deepEqual(host.rows(''), [])
  assert.deepEqual(host.contexts.get('srmd.reviewResources'), {})
}

/**
 * The view, the badges and the Explorer menu follow custom suffixes and watcher reports: a note edited to have no
 * cards keeps its row with zero counts but loses its badge and menu entry; a moved note rebuilds both ancestor
 * chains; deleting it and closing the workspace clear everything.
 */
export async function test_the_view_and_the_explorer_follow_suffixes_edits_moves_and_closure(t) {
  const host = await start_host(t, { 'topic/a.cards.md': 'Q:: answer', 'ignored.sr.md': 'Q:: ignored' }, { suffixes: ['.cards.md'] })
  /** Wait for the watcher batch after this many earlier ones. */
  const batch = count => wait_until(() => host.tree_changes.length === count + 1 && host.decoration_changes.length === count + 1)
  assert.deepEqual(host.rows(''), [folder_row('topic', [0, 1, 0])])
  assert.deepEqual(host.rows('topic'), [note_row('topic/a.cards.md', [0, 1, 0])])
  assert.deepEqual(host.decoration('/workspace/topic/a.cards.md'), { badge: '🔵', tooltip: 'due: 0 • new: 1 • later: 0', propagate: false })
  assert.equal(host.decoration('/workspace/ignored.sr.md'), undefined)
  const topic = host.state.nodes.topic

  host.files.set('/workspace/topic/a.cards.md', { text: 'No cards', mtime: 2 })
  host.edits.fire(uri('/workspace/topic/a.cards.md'))
  await batch(1)
  assert.deepEqual(host.rows(''), [folder_row('topic', [0, 0, 0])])
  assert.deepEqual(host.rows('topic'), [note_row('topic/a.cards.md', [0, 0, 0])])
  assert.deepEqual(['/workspace/topic/a.cards.md', '/workspace/topic', '/workspace'].map(host.decoration), [undefined, undefined, undefined])
  assert.deepEqual(host.contexts.get('srmd.reviewResources'), {})

  // A move is reported as a deletion and a creation.
  host.files.delete('/workspace/topic/a.cards.md')
  host.files.set('/workspace/moved/deep/b.cards.md', { text: 'Q:: moved', mtime: 1 })
  host.deletions.fire(uri('/workspace/topic/a.cards.md'))
  host.changes.fire(uri('/workspace/moved/deep/b.cards.md'))
  await batch(2)
  assert.deepEqual(host.rows(''), [folder_row('moved', [0, 1, 0])])
  assert.deepEqual(host.rows('moved'), [folder_row('moved/deep', [0, 1, 0])])
  assert.deepEqual(host.rows('moved/deep'), [note_row('moved/deep/b.cards.md', [0, 1, 0])])
  // VS Code may still expand the pruned folder it received before the refresh.
  assert.deepEqual(host.tree.getChildren(topic), [])
  assert.deepEqual(host.decoration('/workspace/moved'), { badge: '🔵', tooltip: 'due: 0 • new: 1 • later: 0', propagate: false })
  assert.equal(host.decoration('/workspace/topic'), undefined)
  assert.deepEqual(host.contexts.get('srmd.reviewResources'), {
    'file:///workspace': true,
    'file:///workspace/moved': true,
    'file:///workspace/moved/deep': true,
    'file:///workspace/moved/deep/b.cards.md': true
  })

  host.files.delete('/workspace/moved/deep/b.cards.md')
  host.deletions.fire(uri('/workspace/moved/deep/b.cards.md'))
  await batch(3)
  assert.deepEqual(host.rows(), [root_row([0, 0, 0])])
  assert.deepEqual(host.rows(''), [])
  assert.deepEqual(['/workspace/moved', '/workspace/moved/deep/b.cards.md'].map(host.decoration), [undefined, undefined])
  assert.deepEqual(host.contexts.get('srmd.reviewResources'), {})

  // Closing a workspace with notes clears their rows, badges and menu entries, and stops watching.
  host.files.set('/workspace/last.cards.md', { text: 'Q:: last', mtime: 1 })
  host.changes.fire(uri('/workspace/last.cards.md'))
  await batch(4)
  assert.deepEqual(host.rows(''), [note_row('last.cards.md', [0, 1, 0])])
  host.close_workspace()
  await batch(5)
  assert.deepEqual(host.rows(), [])
  assert.deepEqual(['/workspace/last.cards.md', '/workspace'].map(host.decoration), [undefined, undefined])
  assert.deepEqual(host.contexts.get('srmd.reviewResources'), {})
  assert.equal(host.watcher_disposed, true)
}

/**
 * The minute's recount refreshes the view and the badges whether the view is open or not: here an intraday card
 * reaches its exact due time. After disposal no recount runs.
 */
export async function test_the_minute_recount_refreshes_when_an_intraday_card_becomes_due(t) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: new Date('2026-10-15T12:00:00+02:00') })
  const host = await start_host(t, `
Q:: answer[:1]

[:1]: l 20261015120100 0 20261015120000 8.5 4.2 1 10 1
`.slice(1), {})
  assert.deepEqual(host.rows(), [root_row([0, 0, 1])])
  assert.deepEqual(host.decoration('/workspace'), { badge: '🟢', tooltip: 'due: 0 • new: 0 • later: 1', propagate: false })

  t.mock.timers.tick(60_000)
  await wait_until(() => host.tree_changes.length === 2 && host.decoration_changes.length === 2)
  assert.deepEqual(host.rows(), [root_row([1, 0, 0])])
  assert.deepEqual(host.rows(''), [folder_row('topic', [1, 0, 0])])
  assert.deepEqual(host.rows('topic'), [note_row('topic/a.sr.md', [1, 0, 0])])
  const red = { badge: '🔴', tooltip: 'due: 1 • new: 0 • later: 0', propagate: false }
  assert.deepEqual(['/workspace', '/workspace/topic', '/workspace/topic/a.sr.md'].map(host.decoration), [red, red, red])

  host.dispose()
  t.mock.timers.tick(60_000)
  assert.deepEqual([host.tree_changes, host.decoration_changes], [[undefined, undefined], [undefined, undefined]])
}

/** The minute's recount also refreshes the view and the badges when the review day rolls over at 04:00. */
export async function test_the_minute_recount_refreshes_when_the_review_day_rolls_over(t) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: new Date('2026-10-15T03:59:00+02:00') })
  const host = await start_host(t, `
Q:: answer[:1]

[:1]: k 20261015170000 1 20261014120000 8.5 4.2 0 10 1
`.slice(1), {})
  assert.deepEqual(host.rows(), [root_row([0, 0, 1])])
  assert.deepEqual(host.decoration('/workspace'), { badge: '🟢', tooltip: 'due: 0 • new: 0 • later: 1', propagate: false })

  t.mock.timers.tick(60_000)
  await wait_until(() => host.tree_changes.length === 2 && host.decoration_changes.length === 2)
  assert.deepEqual(host.rows(), [root_row([1, 0, 0])])
  assert.deepEqual(host.rows(''), [folder_row('topic', [1, 0, 0])])
  assert.deepEqual(host.rows('topic'), [note_row('topic/a.sr.md', [1, 0, 0])])
  const red = { badge: '🔴', tooltip: 'due: 1 • new: 0 • later: 0', propagate: false }
  assert.deepEqual(['/workspace', '/workspace/topic', '/workspace/topic/a.sr.md'].map(host.decoration), [red, red, red])

  host.dispose()
  t.mock.timers.tick(60_000)
  assert.deepEqual([host.tree_changes, host.decoration_changes], [[undefined, undefined], [undefined, undefined]])
}

// Run every test_ function above as a test named after it.
for (const [name, fn] of Object.entries(tests)) if (name.startsWith('test_')) test(name, fn)
