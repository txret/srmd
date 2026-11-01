// Choosing what to review (ARCHITECTURE.md, "Review and persistence"): view rows, the Command Palette, the Explorer
// menu, retargeting the open review tab, and Show Note, in the mocked VS Code of host.mjs.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { Position, Range, Selection, TabInputText, folder_row, start_host, uri, wait_until } from './host.mjs'
import * as tests from './scopes.test.mjs'

/** Two notes for choosing what to review: in topic/a.sr.md the due second group is served before the new first group. */
const row_notes = {
  'topic/a.sr.md': `
New:: first

Due:: second[:1]

[:1]: k 20261014040000 7 20261007120000 8.5 4.2 0 10 1
`.slice(1),
  'other/c.sr.md': 'Q:: third'
}

/** The note folder a review tab's card resolves relative resources against, which identifies the note shown. */
const base_of = panel => panel.cards.at(-1).base

/**
 * Enter reviews the selected row, and does nothing while no row is selected.
 * Press Enter with nothing selected, then select a folder row and press it again.
 */
export async function test_enter_reviews_the_selected_row(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00:00+02:00') })
  const host = await start_host(t, row_notes, {})
  await host.press_enter()
  assert.deepEqual(host.panels, [])
  host.select('topic')
  host.press_enter()
  await wait_until(() => host.panel?.document)
  assert.deepEqual(host.panels, ['Review: topic'])
  assert.equal(host.panel.cards.at(-1).base, 'https://resources.test/workspace/topic/')
  assert.deepEqual(host.panel.document.active_ordinals(), [2])
}

/**
 * Review from the Command Palette lists the scopes with cards and their counts, which VS Code narrows as you type.
 * Open the pick, compare its rows, then accept one.
 */
export async function test_the_command_palette_lists_the_scopes_with_cards(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00:00+02:00') })
  const host = await start_host(t, row_notes, {})
  const pending = host.palette_review()
  await wait_until(() => host.quick_pick)
  const pick = host.quick_pick
  assert.deepEqual(pick.options, { placeHolder: 'Choose a note or folder to review' })
  assert.deepEqual(pick.items, [
    { label: '$(root-folder) workspace', description: 'd1 • n2 • l0', path: '' },
    { label: '$(folder) other', description: 'd0 • n1 • l0', path: 'other' },
    { label: '$(file) other/c.sr.md', description: 'd0 • n1 • l0', path: 'other/c.sr.md' },
    { label: '$(folder) topic', description: 'd1 • n1 • l0', path: 'topic' },
    { label: '$(file) topic/a.sr.md', description: 'd1 • n1 • l0', path: 'topic/a.sr.md' }
  ])
  pick.accept(4)
  await wait_until(() => host.panel?.document)
  assert.deepEqual(host.panels, ['Review: a.sr.md'])
  host.panel.dispose()
  await pending
}

/**
 * Dismissing the Command Palette pick reviews nothing.
 */
export async function test_dismissing_the_command_palette_pick_reviews_nothing(t) {
  const host = await start_host(t, row_notes, {})
  const pending = host.palette_review()
  await wait_until(() => host.quick_pick)
  host.quick_pick.hide()
  await pending
  assert.deepEqual(host.panels, [])
}

/**
 * Explorer Review ignores resources outside the loaded note tree.
 * Even direct command calls cannot redirect a note scope to an unrelated resource.
 */
export async function test_explorer_review_ignores_resources_outside_the_notes(t) {
  const host = await start_host(t, 'Q:: answer', {})
  await host.review(uri('/elsewhere/topic/a.sr.md'))
  await host.review(uri('/workspace/ordinary.md'))
  assert.equal(host.panel, undefined)
  assert.deepEqual(host.messages, [])
  assert.deepEqual(host.files.get('/workspace/topic/a.sr.md'), { text: 'Q:: answer', mtime: 1 })
}

/**
 * Reviewing another scope retargets the open review tab and leaves the shown card unrated.
 * Open other/ from the Explorer menu, then review topic/ from its row: the same tab continues with topic's cards
 * only.
 */
export async function test_reviewing_another_scope_retargets_the_open_tab(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00:00+02:00') })
  const host = await start_host(t, row_notes, {})
  const pending = host.review(uri('/workspace/other'))
  await wait_until(() => host.panel?.document)
  const panel = host.panel
  const other_document = panel.document
  host.review_row('topic')
  await wait_until(() => panel.document !== other_document)
  assert.equal(host.panel, panel)
  assert.deepEqual(host.panels, ['Review: other'])
  assert.equal(panel.title, 'Review: topic')
  assert.equal(panel.reveals, 1)
  assert.equal(base_of(panel), 'https://resources.test/workspace/topic/')
  assert.deepEqual(panel.document.active_ordinals(), [2])
  assert.deepEqual(host.messages, [{ type: 'ready' }])

  // Both of topic's cards are rated in the retargeted tab, which then closes; other/c.sr.md was never rated.
  for (const ordinals of [[2], [1]]) {
    await wait_until(() => panel.document && !panel.disposed)
    assert.deepEqual(panel.document.active_ordinals(), ordinals)
    const document = panel.document
    panel.reply('tomorrow')
    await wait_until(() => panel.disposed || panel.document !== document)
  }
  await pending
  assert.equal(panel.disposed, true)
  assert.deepEqual(host.panels, ['Review: other'])
  assert.deepEqual(host.files.get('/workspace/topic/a.sr.md'), {
    text: `
New:: first[:1]

Due:: second[:2]

[:1]: k 20261016040000 1 20261015120000 2.3065 2.11810397 0 1 0
[:2]: k 20261016040000 1 20261015120000 8.5 4.2 0 11 1
`.slice(1),
    mtime: 3
  })
  assert.deepEqual(host.files.get('/workspace/other/c.sr.md'), { text: 'Q:: third', mtime: 1 })
}

/**
 * Reviewing the scope that is already open only reveals its tab.
 * Reviewing the same row again must neither reopen nor skip the card being shown.
 */
export async function test_reviewing_the_open_scope_only_reveals_its_tab(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00:00+02:00') })
  const host = await start_host(t, row_notes, {})
  host.review_row('topic')
  await wait_until(() => host.panel?.document)
  const document = host.panel.document
  host.review_row('topic')
  await wait_until(() => host.panel.reveals === 1)
  await delay(20)
  assert.equal(host.panel.document, document)
  assert.deepEqual(host.panels, ['Review: topic'])
  assert.equal(host.panel.title, 'Review: topic')
  assert.deepEqual(host.messages, [{ type: 'ready' }])
}

/**
 * A retarget during a save keeps the rating and serves the next card from the new scope.
 * Hold the write of topic's first rating, retarget to other/, then release the write.
 */
export async function test_a_retarget_during_a_save_keeps_the_rating(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00:00+02:00') })
  const host = await start_host(t, row_notes, {})
  host.review_row('topic')
  await wait_until(() => host.panel?.document)
  const topic_document = host.panel.document
  const finish_write = host.pause_writes()
  try {
    host.panel.reply('tomorrow')
    await wait_until(() => host.writing)
    host.review_row('other')
    await wait_until(() => host.panel.title === 'Review: other')
    assert.equal(host.panel.document, topic_document)
  } finally {
    finish_write()
  }
  await wait_until(() => host.panel.document !== topic_document)
  assert.equal(base_of(host.panel), 'https://resources.test/workspace/other/')
  assert.deepEqual(host.panel.document.active_ordinals(), [1])
  assert.deepEqual(host.panels, ['Review: topic'])
  assert.deepEqual(host.files.get('/workspace/topic/a.sr.md'), {
    text: `
New:: first

Due:: second[:1]

[:1]: k 20261016040000 1 20261015120000 8.5 4.2 0 11 1
`.slice(1),
    mtime: 2
  })
}

/**
 * After the review tab closes the next review opens a new tab.
 * Closing ends the old loop; a later review must not be mistaken for a retarget.
 */
export async function test_after_the_tab_closes_the_next_review_opens_a_new_one(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00:00+02:00') })
  const host = await start_host(t, row_notes, {})
  host.review_row('other')
  await wait_until(() => host.panel?.document)
  const first = host.panel
  first.dispose()
  host.review_row('topic')
  await wait_until(() => host.panel !== first && host.panel.document)
  assert.deepEqual(host.panels, ['Review: other', 'Review: topic'])
  assert.equal(base_of(host.panel), 'https://resources.test/workspace/topic/')
  assert.equal(first.reveals, 0)
}

/**
 * Simultaneous Review commands open a single tab.
 * The tab is reserved before the first await, so the second call retargets it.
 */
export async function test_simultaneous_reviews_open_one_tab(t) {
  const host = await start_host(t, row_notes, {})
  host.review(uri('/workspace/topic'))
  host.review(uri('/workspace/other'))
  await wait_until(() => host.panel?.document)
  assert.deepEqual(host.panels, ['Review: topic'])
  assert.equal(host.panel.title, 'Review: other')
  host.panel.dispose()
}

/**
 * Show Note opens the shown card's note beside the review at its cloze, or shows the tab that has it open.
 * Without a review nothing opens; then show the note with no tab for it, and with a tab in the second group.
 */
export async function test_show_note_opens_the_card_s_note_at_its_cloze(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00:00+02:00') })
  const host = await start_host(t, row_notes, {})
  await host.command('srmd.showNote')
  assert.deepEqual(host.opened, [])
  host.review_row('topic/a.sr.md')
  await wait_until(() => host.panel?.document)
  await host.command('srmd.showNote')
  host.tab_groups = [
    { viewColumn: 1, tabs: [{ input: {} }] },
    { viewColumn: 2, tabs: [{ input: new TabInputText(uri('/workspace/topic/a.sr.md')) }] }
  ]
  await host.command('srmd.showNote')
  // The card shown is the note's second, `Due:: second`, whose cloze starts at `second` on the third line.
  const cursor = new Position(2, 6)
  const at_cloze = [new Selection(cursor, cursor), [new Range(cursor, cursor), 2]]
  assert.deepEqual(host.opened.map(({ path, options, editor }) => [path, options, editor.selection, editor.revealed]), [
    ['/workspace/topic/a.sr.md', { viewColumn: -2, preview: false }, ...at_cloze],
    ['/workspace/topic/a.sr.md', { viewColumn: 2, preview: false }, ...at_cloze]
  ])
  host.panel.dispose()
}

/**
 * A row's Review button reviews its note, starting with the due card, its folder only, or for the open folder's row
 * the whole workspace; the tab is titled after the row.
 */
export async function test_row_review_buttons_review_their_note_folder_or_workspace(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00:00+02:00') })
  const note = await start_host(t, row_notes, {})
  note.review_row('topic/a.sr.md')
  await wait_until(() => note.panel?.document)
  assert.deepEqual(note.panels, ['Review: a.sr.md'])
  assert.equal(base_of(note.panel), 'https://resources.test/workspace/topic/')
  assert.deepEqual(note.panel.document.active_ordinals(), [2])

  const folder = await start_host(t, row_notes, {})
  folder.review_row('other')
  await wait_until(() => folder.panel?.document)
  assert.deepEqual(folder.panels, ['Review: other'])
  assert.equal(base_of(folder.panel), 'https://resources.test/workspace/other/')
  assert.deepEqual(folder.panel.document.active_ordinals(), [1])

  const workspace = await start_host(t, row_notes, {})
  workspace.review_row('')
  await wait_until(() => workspace.panel?.document)
  assert.deepEqual(workspace.panels, ['Review: workspace'])
  assert.equal(base_of(workspace.panel), 'https://resources.test/workspace/topic/')
  assert.deepEqual(workspace.panel.document.active_ordinals(), [2])
}

/** Review a scope from the Explorer menu, rating every card it serves Tomorrow until its tab closes. */
async function review_every_card(host, scope) {
  /* Answer each card shown, then wait for the next card or for the tab to close. */
  const pending = host.review(uri(scope))
  while (true) {
    await wait_until(() => host.panel?.document || host.panel?.disposed)
    if (host.panel.disposed) break
    const document = host.panel.document
    host.panel.reply('tomorrow')
    await wait_until(() => host.panel.disposed || host.panel.document !== document)
  }
  await pending
}

/**
 * Review from the Explorer menu reviews the chosen note, folder or workspace and nothing else: only its cards are
 * rated and saved, and its siblings keep their counts and text.
 */
export async function test_explorer_review_reviews_only_the_chosen_scope(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00:00+02:00') })
  const notes = { 'topic/a.sr.md': 'Q:: first', 'topic/b.sr.md': 'Q:: second', 'other/c.sr.md': 'Q:: third' }

  const note = await start_host(t, notes, {})
  await review_every_card(note, '/workspace/topic/a.sr.md')
  assert.equal(note.messages.filter(message => message.type === 'review').length, 1)
  assert.deepEqual(note.decoration('/workspace/topic/a.sr.md'), { badge: '🟢', tooltip: 'due: 0 • new: 0 • later: 1', propagate: false })
  assert.deepEqual(note.decoration('/workspace'), { badge: '🔵', tooltip: 'due: 0 • new: 2 • later: 1', propagate: false })
  assert.deepEqual(note.rows(''), [folder_row('other', [0, 1, 0]), folder_row('topic', [0, 1, 1])])
  assert.deepEqual(note.files.get('/workspace/topic/b.sr.md'), { text: 'Q:: second', mtime: 1 })
  assert.deepEqual(note.files.get('/workspace/other/c.sr.md'), { text: 'Q:: third', mtime: 1 })

  const folder = await start_host(t, notes, {})
  await review_every_card(folder, '/workspace/topic')
  assert.equal(folder.messages.filter(message => message.type === 'review').length, 2)
  assert.deepEqual(folder.decoration('/workspace/topic'), { badge: '🟢', tooltip: 'due: 0 • new: 0 • later: 2', propagate: false })
  assert.deepEqual(folder.decoration('/workspace'), { badge: '🔵', tooltip: 'due: 0 • new: 1 • later: 2', propagate: false })
  assert.deepEqual(folder.rows(''), [folder_row('other', [0, 1, 0]), folder_row('topic', [0, 0, 2])])
  assert.deepEqual(folder.files.get('/workspace/other/c.sr.md'), { text: 'Q:: third', mtime: 1 })

  const workspace = await start_host(t, notes, {})
  await review_every_card(workspace, '/workspace')
  assert.equal(workspace.messages.filter(message => message.type === 'review').length, 3)
  assert.deepEqual(workspace.decoration('/workspace'), { badge: '🟢', tooltip: 'due: 0 • new: 0 • later: 3', propagate: false })
  assert.deepEqual(workspace.rows(''), [folder_row('other', [0, 0, 1]), folder_row('topic', [0, 0, 2])])
}

// Run every test_ function above as a test named after it.
for (const [name, fn] of Object.entries(tests)) if (name.startsWith('test_')) test(name, fn)
