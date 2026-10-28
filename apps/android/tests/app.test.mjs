// The app in a browser (ARCHITECTURE.md, "Screen and interaction"): the built web app in headless Chromium with the
// mock shell (mock_native.js), driven by touch as on a phone. Skipped when no Chromium is found (see find_chromium()).
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { find_chromium, launch, start_server } from './browser.mjs'
import * as tests from './app.test.mjs'

/** The Chromium to test with, or null, which skips these tests; so does a Node without WebSocket, before Node 22. */
const chromium = typeof WebSocket === 'function' ? find_chromium() : null
/** The browser and server, started for the first test and shared by all, each test in its own browser context. */
let shared = null

/** The shared browser and server, started on first use. */
async function session() {
  shared ??= Promise.all([launch(chromium), start_server()]).then(([browser, server]) => ({ browser, server }))
  return shared
}
after(async () => {
  if (!shared) return
  const { browser, server } = await shared
  await browser.close()
  await server.close()
})

/**
 * Load the app with the mock shell holding files (path: text) and wait until its first scan loaded the notes. The clock
 * stands at 15 October 2026, 12:00 in Stockholm, and nothing animates. The page closes when the test ends.
 */
async function open_app(t, files, settings = null) {
  const { browser, server } = await session()
  server.setup = { files, settings, now: new Date('2026-10-15T12:00:00+02:00').getTime(), still: true }
  const page = await browser.new_page()
  t.after(() => page.close())
  await page.goto(`${server.origin}/app/index.html`)
  await page.wait_for(`window.srmd_app?.library?.workspace.state.nodes[''] !== undefined`)
  return page
}

/** The kinds of the open layers, bottom first, joined by commas. */
const layers = page => page.evaluate(`window.srmd_app.layers.map(layer => layer.kind).join()`)
/** What the main view shows: view, review, edit or empty. */
const mode = page => page.evaluate(`document.getElementById('main').dataset.mode`)
/** The tree's rows as [path, counts, matches], counts and matches '' where a row has none. */
const rows = page => page.evaluate(`[...document.querySelectorAll('#tree .row')].map(row =>
  [row.dataset.path, row.querySelector('.counts')?.textContent ?? '', row.querySelector('.matches')?.textContent ?? ''])`)
/** Swipe right over the note, opening the drawer. */
const swipe_right = page => page.swipe({ x: 60, y: 400 }, { x: 330, y: 410 })
/** Press Back, as the shell reports it: to the page while it said something is open. */
const back = page => page.evaluate('window.mock_native.back()')

/**
 * Swiping right opens the drawer with every file: notes and folders with counts, other files without. A file opened
 * there replaces the shown file and closes the drawer; a note shows every cloze. With nothing open, Back leaves the app.
 */
export async function test_a_note_opened_from_the_drawer_shows_every_cloze(t) {
  const page = await open_app(t, { 'topic/heart.sr.md': 'The heart has:: four chambers\n', 'readme.md': '# Read me\n', 'diagram.png': 'PNG' })
  assert.equal(await mode(page), 'empty')
  await swipe_right(page)
  await page.wait_for(`document.getElementById('drawer').classList.contains('open')`)
  assert.equal(await layers(page), 'drawer')
  assert.deepEqual(await rows(page), [['', 'd0 • n1 • l0', ''], ['topic', 'd0 • n1 • l0', ''], ['diagram.png', '', ''], ['readme.md', '', '']])

  await page.tap('#tree .row[data-path="topic"] .name')
  await page.tap('#tree .row[data-path="topic/heart.sr.md"] .name')
  await page.wait_for(`document.querySelector('#view .note')`)
  assert.equal(await mode(page), 'view')
  assert.equal(await layers(page), '')
  assert.equal(await page.evaluate(`document.querySelector('#view .note').innerHTML`),
    '<p>The heart has: <span class="cloze" data-ordinal="1" data-card="[:-1]: n 0 0 0 0 0 0 0 0">four chambers</span></p>\n')
  assert.equal(await page.evaluate(`document.getElementById('drawer').classList.contains('open')`), false)

  await back(page)
  assert.deepEqual(await page.evaluate('[window.mock_native.state.back_handled, window.mock_native.state.exited]'), [false, true])
}

/**
 * Searching all files shows the matching files as a tree, with their text match counts. Back clears the search,
 * showing every file again, then closes the drawer.
 */
export async function test_back_clears_the_drawer_search_then_closes_the_drawer(t) {
  const page = await open_app(t, { 'a.md': 'apple pie\n', 'fruit/b.md': 'banana, banana\n' })
  await swipe_right(page)
  await page.tap('#library-search')
  await page.type('banana')
  await page.wait_for(`document.querySelector('#tree .matches')`)
  assert.deepEqual(await rows(page), [['', 'd0 • n0 • l0', ''], ['fruit', '', ''], ['fruit/b.md', '', '2']])
  assert.equal(await layers(page), 'drawer,drawer_search')
  assert.equal(await page.evaluate('window.mock_native.state.back_handled'), true)

  await back(page)
  await page.wait_for(`window.srmd_app.layers.length === 1`)
  assert.equal(await page.evaluate(`document.getElementById('library-search').value`), '')
  assert.deepEqual(await rows(page), [['', 'd0 • n0 • l0', ''], ['fruit', '', ''], ['a.md', '', '']])

  await back(page)
  await page.wait_for(`!document.getElementById('drawer').classList.contains('open')`)
  assert.equal(await layers(page), '')
  assert.equal(await page.evaluate('window.mock_native.state.back_handled'), false)
}

/**
 * A review from a tree row shows each card in the shared reviewer and saves its rating to the note: the overdue card
 * first, then the new one, whose Tomorrow schedules it for the next review day and seeds its memory. When no card is
 * left, review ends on the note in view mode.
 */
export async function test_a_review_saves_each_rating_and_ends_on_the_note(t) {
  const page = await open_app(t, { 'notes.sr.md': 'Q:: one\n\nK:: two[:1]\n\n[:1]: k 20261014040000 7 20261007120000 8.5 4.2 0 10 1\n' })
  await swipe_right(page)
  await page.tap('#tree .row[data-path="notes.sr.md"] .review')
  await page.wait_for(`document.querySelector('#review .sr-reviewer')`)
  assert.equal(await mode(page), 'review')
  assert.equal(await layers(page), 'review')
  assert.equal(await page.evaluate(`document.querySelector('#review .title').textContent`), 'notes.sr.md')
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('#review .cloze.active')].map(cloze => cloze.dataset.ordinal)`), ['2'])

  await page.tap('#review .footer .front .flip-btn')
  await page.tap('#review .choice-btn[data-id="good"]')
  await page.wait_for(`window.mock_native.state.writes.length === 1 && document.querySelector('#review .cloze.active[data-ordinal="1"]')`)
  assert.deepEqual(await page.evaluate('window.mock_native.state.writes'), [
    ['notes.sr.md', 'Q:: one\n\nK:: two[:1]\n\n[:1]: k 20261113110000 29 20261015120000 29.3706596 4.19102837 0 11 1\n']
  ])

  await page.tap('#review .footer .front .flip-btn')
  await page.tap('#review .choice-btn[data-id="tomorrow"]')
  await page.wait_for(`document.getElementById('main').dataset.mode === 'view'`)
  assert.deepEqual((await page.evaluate('window.mock_native.state.writes'))[1], [
    'notes.sr.md',
    'Q:: one[:1]\n\nK:: two[:2]\n\n[:1]: k 20261016040000 1 20261015120000 2.3065 2.11810397 0 1 0\n[:2]: k 20261113110000 29 20261015120000 29.3706596 4.19102837 0 11 1\n'
  ])
  assert.equal(await layers(page), '')
  assert.equal(await page.evaluate(`document.getElementById('toast').textContent`), 'No more cards to review in notes.sr.md.')
  await page.wait_for(`document.querySelector('#view .note')?.textContent.includes('one')`)
  assert.equal(await page.evaluate(`window.srmd_app.shown_path()`), 'notes.sr.md')
}

/**
 * The drawer's toggle edits the shown file in CodeMirror. Leaving edit mode with a change asks first: Keep editing
 * stays, Save writes the edit and shows the file again in view mode.
 */
export async function test_leaving_edit_mode_asks_to_save_and_saves_the_edit(t) {
  const page = await open_app(t, { 'a.md': '# Title\n' })
  await swipe_right(page)
  await page.tap('#tree .row[data-path="a.md"] .name')
  await page.wait_for(`document.querySelector('#view .note')`)
  await swipe_right(page)
  await page.tap('#toggle')
  await page.wait_for(`document.querySelector('#editor .cm-content')`)
  assert.equal(await mode(page), 'edit')
  assert.equal(await layers(page), 'edit')
  assert.equal(await page.evaluate(`document.querySelector('#editor .cm-content').textContent`), '# Title')

  await page.evaluate(`document.querySelector('#editor .cm-content').focus()`)
  await page.type('New: ')
  await back(page)
  await page.wait_for(`!document.getElementById('dialog').hidden`)
  assert.equal(await page.evaluate(`document.querySelector('#dialog p').textContent`), 'Save your changes to a.md?')
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('#dialog button')].map(button => button.textContent)`), ['Save', 'Discard', 'Keep editing'])
  assert.equal(await layers(page), 'edit,dialog')

  await page.tap('#dialog button[data-id="keep"]')
  await page.wait_for(`document.getElementById('dialog').hidden`)
  assert.equal(await layers(page), 'edit')
  assert.equal(await mode(page), 'edit')

  await back(page)
  await page.wait_for(`!document.getElementById('dialog').hidden`)
  await page.tap('#dialog button[data-id="save"]')
  await page.wait_for(`document.getElementById('main').dataset.mode === 'view'`)
  assert.deepEqual(await page.evaluate('window.mock_native.state.writes'), [['a.md', 'New: # Title\n']])
  await page.wait_for(`document.querySelector('#view .note')?.innerHTML === '<p>New: # Title</p>\\n'`)
  assert.equal(await layers(page), '')
  assert.equal(await page.evaluate(`document.getElementById('toast').textContent`), 'Saved a.md.')
}

/** The lines of the text CodeMirror shows, joined by line breaks. */
const editor_text = page => page.evaluate(`[...document.querySelectorAll('#editor .cm-line')].map(line => line.textContent).join('\\n')`)

/**
 * The drawer's Format, enabled in edit mode for Markdown files, formats the text being edited and closes the drawer;
 * Shift+Alt+F does too, and a toast says when the text is formatted already. Saving writes the formatted text. A text
 * file is not formatted.
 */
export async function test_the_text_being_edited_is_formatted(t) {
  const page = await open_app(t, { 'a.sr.md': 'Q::\n* one\n* two\n', 'b.txt': '* text\n' })
  await swipe_right(page)
  await page.tap('#tree .row[data-path="b.txt"] .name')
  await page.wait_for(`document.querySelector('#view .plain')`)
  await swipe_right(page)
  await page.tap('#toggle')
  await page.wait_for(`document.querySelector('#editor .cm-content')`)
  await swipe_right(page)
  assert.equal(await page.evaluate(`document.getElementById('format').disabled`), true)
  await page.tap('#toggle')
  await page.wait_for(`document.getElementById('main').dataset.mode === 'view'`)

  await swipe_right(page)
  await page.tap('#tree .row[data-path="a.sr.md"] .name')
  await page.wait_for(`document.querySelector('#view .note')`)
  await swipe_right(page)
  assert.equal(await page.evaluate(`document.getElementById('format').disabled`), true)
  await page.tap('#toggle')
  await page.wait_for(`document.querySelector('#editor .cm-content')`)
  await swipe_right(page)
  assert.equal(await page.evaluate(`document.getElementById('format').getAttribute('aria-label')`), 'Format')
  assert.equal(await page.evaluate(`document.getElementById('format').disabled`), false)
  await page.tap('#format')
  await page.wait_for(`!document.getElementById('drawer').classList.contains('open')`)
  assert.equal(await editor_text(page), 'Q::\n\n- one\n- two\n')
  assert.equal(await layers(page), 'edit')

  await page.evaluate(`document.querySelector('#editor .cm-content').focus()`)
  await page.press('F', 'KeyF', 1 | 8)
  assert.equal(await page.evaluate(`document.getElementById('toast').textContent`), 'a.sr.md is already formatted.')
  await back(page)
  await page.wait_for(`!document.getElementById('dialog').hidden`)
  await page.tap('#dialog button[data-id="save"]')
  await page.wait_for(`document.getElementById('main').dataset.mode === 'view'`)
  assert.deepEqual(await page.evaluate('window.mock_native.state.writes'), [['a.sr.md', 'Q::\n\n- one\n- two\n']])
}

/**
 * Text whose formatted form would render differently stays as it is, with a toast: a table row with more cells than
 * its header would widen the header.
 */
export async function test_text_that_would_render_differently_stays_unformatted(t) {
  const page = await open_app(t, { 'a.md': '| a |\n|---|\n| b | extra |\n' })
  await swipe_right(page)
  await page.tap('#tree .row[data-path="a.md"] .name')
  await page.wait_for(`document.querySelector('#view .note')`)
  await swipe_right(page)
  await page.tap('#toggle')
  await page.wait_for(`document.querySelector('#editor .cm-content')`)
  await swipe_right(page)
  await page.tap('#format')
  await page.wait_for(`document.getElementById('toast').textContent`)
  assert.equal(await page.evaluate(`document.getElementById('toast').textContent`), 'Formatting a.md would change how it renders, so it was left unchanged.')
  assert.equal(await editor_text(page), '| a |\n|---|\n| b | extra |\n')
}

/**
 * An edit of a file a sync changed meanwhile is not saved over it: the user may keep editing, which writes nothing, or
 * overwrite the file.
 */
export async function test_an_edit_of_a_file_changed_meanwhile_is_not_overwritten(t) {
  const page = await open_app(t, { 'a.md': 'one\n' })
  await swipe_right(page)
  await page.tap('#tree .row[data-path="a.md"] .name')
  await page.wait_for(`document.querySelector('#view .note')`)
  await swipe_right(page)
  await page.tap('#toggle')
  await page.wait_for(`document.querySelector('#editor .cm-content')`)
  await page.evaluate(`document.querySelector('#editor .cm-content').focus()`)
  await page.type('mine ')
  await page.evaluate(`window.mock_native.sync('a.md', 'synced\\n')`)

  await back(page)
  await page.wait_for(`!document.getElementById('dialog').hidden`)
  await page.tap('#dialog button[data-id="save"]')
  await page.wait_for(`document.querySelector('#dialog button[data-id="overwrite"]')`)
  assert.equal(await page.evaluate(`document.querySelector('#dialog p').textContent`), 'a.md changed since you began editing, for instance by a sync.')
  await page.tap('#dialog button[data-id="keep"]')
  await page.wait_for(`document.getElementById('dialog').hidden`)
  assert.equal(await mode(page), 'edit')
  assert.deepEqual(await page.evaluate('window.mock_native.state.writes'), [])
  assert.equal(await page.evaluate(`window.mock_native.files['a.md'].text`), 'synced\n')

  await back(page)
  await page.wait_for(`!document.getElementById('dialog').hidden`)
  await page.tap('#dialog button[data-id="save"]')
  await page.wait_for(`document.querySelector('#dialog button[data-id="overwrite"]')`)
  await page.tap('#dialog button[data-id="overwrite"]')
  await page.wait_for(`document.getElementById('main').dataset.mode === 'view'`)
  assert.deepEqual(await page.evaluate('window.mock_native.state.writes'), [['a.md', 'mine one\n']])
}

/**
 * A link to a file opens it over the shown one, and Back returns; a web link opens outside the app, and a file that
 * does not open in the app opens in its Android app.
 */
export async function test_links_open_files_over_the_note_and_back_returns(t) {
  const page = await open_app(t, {
    'topic/a.md': '# A\n\nSee [b](../b.md), [the web](https://example.com/x) and [a picture](diagram.png).\n', 'b.md': '# B\n', 'topic/diagram.png': 'PNG'
  })
  await swipe_right(page)
  await page.tap('#tree .row[data-path="topic"] .name')
  await page.tap('#tree .row[data-path="topic/a.md"] .name')
  await page.wait_for(`document.querySelector('#view .note')`)

  await page.tap('#view a[href="../b.md"]')
  await page.wait_for(`window.srmd_app.shown_path() === 'b.md' && document.querySelector('#view .note')?.innerHTML === '<h1>B</h1>\\n'`)
  assert.equal(await layers(page), 'link')
  assert.equal(await page.evaluate('window.mock_native.state.back_handled'), true)

  await back(page)
  await page.wait_for(`window.srmd_app.shown_path() === 'topic/a.md' && document.querySelector('#view a[href="../b.md"]')`)
  assert.equal(await layers(page), '')

  await page.tap('#view a[href="https://example.com/x"]')
  await page.tap('#view a[href="diagram.png"]')
  await page.wait_for(`window.mock_native.state.opened.length`)
  assert.deepEqual(await page.evaluate('[window.mock_native.state.links, window.mock_native.state.opened]'), [['https://example.com/x'], ['topic/diagram.png']])
  assert.equal(await page.evaluate(`window.srmd_app.shown_path()`), 'topic/a.md')
}

/**
 * Swiping up from the handle opens the search of the shown file, asking the shell for the keyboard, which a swipe does
 * not bring up by itself: matches are counted and stepped through both ways.
 */
export async function test_swiping_up_from_the_handle_searches_the_shown_file(t) {
  const page = await open_app(t, { 'a.md': 'one two One\n' })
  await swipe_right(page)
  await page.tap('#tree .row[data-path="a.md"] .name')
  await page.wait_for(`document.querySelector('#view .note')`)
  await page.swipe({ x: 206, y: 850 }, { x: 206, y: 760 }, 4)
  await page.wait_for(`!document.getElementById('note-search').hidden`)
  assert.equal(await layers(page), 'note_search')
  await page.wait_for(`window.mock_native.state.keyboard_requests === 1`)
  await page.type('one')
  const count = () => page.evaluate(`document.querySelector('#note-search .count').textContent`)
  await page.wait_for(`document.querySelector('#note-search .count').textContent`)
  assert.equal(await count(), '1/2')
  assert.equal(await page.evaluate(`document.querySelectorAll('#view .matches, #view .match').length`), 2)
  await page.tap('#note-search .next')
  assert.equal(await count(), '2/2')
  await page.tap('#note-search .next')
  assert.equal(await count(), '1/2')
  await page.tap('#note-search .previous')
  assert.equal(await count(), '2/2')

  await back(page)
  await page.wait_for(`document.getElementById('note-search').hidden`)
  assert.equal(await layers(page), '')
  assert.equal(await page.evaluate(`document.querySelectorAll('#view .matches, #view .match').length`), 0)
}

/**
 * Settings are stored through the shell as they change; new note suffixes load the notes again. Back closes the
 * settings page.
 */
export async function test_changed_settings_are_stored_and_reload_the_notes(t) {
  const page = await open_app(t, { 'a.sr.md': 'Q:: one\n', 'b.cards.md': 'Q:: two\n' })
  assert.deepEqual(await page.evaluate(`Object.keys(window.srmd_app.library.workspace.state.nodes).sort()`), ['', 'a.sr.md'])
  await swipe_right(page)
  await page.tap('#open-settings')
  await page.wait_for(`!document.getElementById('settings').hidden`)
  assert.equal(await layers(page), 'settings')

  await page.evaluate(`(() => {
    const input = document.querySelector('#settings input[name="suffixes"]')
    input.value = '.cards.md'
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await page.wait_for(`window.srmd_app.library.workspace.state.nodes['b.cards.md']`)
  assert.deepEqual(await page.evaluate('window.mock_native.state.settings'), { suffixes: ['.cards.md'] })
  assert.deepEqual(await page.evaluate(`Object.keys(window.srmd_app.library.workspace.state.nodes).sort()`), ['', 'b.cards.md'])

  await back(page)
  await page.wait_for(`document.getElementById('settings').hidden`)
  assert.equal(await layers(page), '')
}

/**
 * The settings page's Formatting section offers the formatting options, the values in effect selected. A change is
 * stored, and the editor's Format follows it; a line width too narrow is marked and not stored.
 */
export async function test_formatting_follows_the_formatting_settings(t) {
  const page = await open_app(t, { 'a.md': 'One two three four five six seven eight.\n\n- a\n- b\n' })
  await swipe_right(page)
  await page.tap('#open-settings')
  await page.wait_for(`!document.getElementById('settings').hidden`)
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('#settings select[name^="format."]')]
    .map(select => [select.name, select.value, [...select.options].map(option => option.textContent)])`), [
    ['format.wrap', 'preserve', ['As written', 'Wrapped at the line width', 'One per paragraph']],
    ['format.numbering', 'increment', ['Counting up: 1. 2. 3.', 'The first number repeated: 1. 1. 1.']],
    ['format.bullet', '-', ['- …', '* …', '+ …']],
    ['format.tableDelimiters', 'compact', ['|---|:-:|', '| --- | :-: |']],
    ['format.emphasis', 'preserve', ['As written', '*…*', '_…_']],
    ['format.strong', 'preserve', ['As written', '**…**', '__…__']]
  ])
  assert.equal(await page.evaluate(`document.querySelector('#settings input[name="format.lineWidth"]').value`), '80')

  /** Set a settings control's value, as choosing or typing it does. */
  const change = (name, value) => page.evaluate(`(() => {
    const control = document.querySelector('#settings [name="${name}"]')
    control.value = '${value}'
    control.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await change('format.lineWidth', '10')
  assert.equal(await page.evaluate(`document.querySelector('#settings [name="format.lineWidth"]').getAttribute('aria-invalid')`), 'true')
  await change('format.lineWidth', '20')
  await change('format.wrap', 'always')
  await change('format.bullet', '*')
  await page.wait_for(`window.mock_native.state.settings?.['format.bullet'] === '*'`)
  assert.deepEqual(await page.evaluate('window.mock_native.state.settings'), { 'format.lineWidth': 20, 'format.wrap': 'always', 'format.bullet': '*' })
  await back(page)
  await page.wait_for(`document.getElementById('settings').hidden`)

  await swipe_right(page)
  await page.tap('#tree .row[data-path="a.md"] .name')
  await page.wait_for(`document.querySelector('#view .note')`)
  await swipe_right(page)
  await page.tap('#toggle')
  await page.wait_for(`document.querySelector('#editor .cm-content')`)
  await swipe_right(page)
  await page.tap('#format')
  await page.wait_for(`!document.getElementById('drawer').classList.contains('open')`)
  assert.equal(await editor_text(page), 'One two three four\nfive six seven\neight.\n\n* a\n* b\n')
}

/** An edit not yet saved when the app goes to the background returns in edit mode after Android ends and restarts the app. */
export async function test_an_unsaved_edit_returns_after_a_restart(t) {
  const page = await open_app(t, { 'a.md': 'one\n' })
  await swipe_right(page)
  await page.tap('#tree .row[data-path="a.md"] .name')
  await page.wait_for(`document.querySelector('#view .note')`)
  await swipe_right(page)
  await page.tap('#toggle')
  await page.wait_for(`document.querySelector('#editor .cm-content')`)
  await page.evaluate(`document.querySelector('#editor .cm-content').focus()`)
  await page.type('draft ')
  await page.evaluate(`window.mock_native.emit('pause')`)
  // The draft is kept in IndexedDB in the background; wait until it is there, then load the page anew.
  await page.wait_for(`new Promise(resolve => {
    const request = indexedDB.open('srmd')
    request.onsuccess = () => {
      const get = request.result.transaction('values').objectStore('values').get('draft')
      get.onsuccess = () => resolve(get.result?.text === 'draft one\\n')
    }
  })`)

  await page.goto(await page.evaluate('location.href'))
  await page.wait_for(`document.getElementById('main').dataset.mode === 'edit'`)
  assert.equal(await page.evaluate(`document.querySelector('#editor .cm-content').textContent`), 'draft one')
  assert.equal(await layers(page), 'edit')
  assert.equal(await page.evaluate(`document.getElementById('toast').textContent`), 'Restored your unsaved changes to a.md.')
}

// Run every test_ function above as a test named after it.
for (const [name, fn] of Object.entries(tests)) if (name.startsWith('test_')) test(name, { skip: chromium ? false : 'no Chromium found (set CHROME), or no WebSocket in this Node' }, fn)
